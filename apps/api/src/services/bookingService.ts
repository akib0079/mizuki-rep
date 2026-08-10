import { Types } from 'mongoose'
import {
  evaluateCancel,
  evaluateReschedule,
  evaluateSessionBookable,
  type BookingSource,
} from '@mizuki/shared'
import {
  BookingModel,
  CourseTypeModel,
  PackageModel,
  SessionModel,
  StudentModel,
  type BookingDoc,
  type CourseTypeDoc,
  type PackageDoc,
  type SessionDoc,
  type StudentDoc,
} from '../models/index.js'
import { AppError, ConflictError, NotFoundError, ruleError } from '../errors.js'
import { releaseSeat, reserveSeat } from './seatService.js'
import { consumeSession, findUsablePackage, restoreSession } from './packageService.js'
import {
  queueAdminBookingChange,
  queueAdminNewBooking,
  queueBookingCancelled,
  queueBookingConfirmation,
  queueRescheduleConfirmation,
} from './notificationService.js'
import { recordAudit } from './auditService.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Booking, cancelling and rescheduling — the operations that touch a seat, a course credit and
 * a student's inbox at once.
 *
 * Each one claims scarce resources in a deliberate order and undoes what it claimed if a later
 * step fails. On Atlas these also run inside a transaction, but the compensation is written out
 * regardless: the seat counter is guarded independently of the transaction, and a half-applied
 * booking is the one failure mode that would let a class be oversold.
 */

export interface CreateBookingInput {
  sessionId: Types.ObjectId | string
  studentId: Types.ObjectId | string
  source?: BookingSource
  status?: 'hold' | 'confirmed'
  /** Spend a course credit when the course works that way and the student has one. */
  usePackage?: boolean
  /** Studio-only: seat someone in a class that is already full. Always audited. */
  overrideCapacity?: boolean
  holdToken?: string | null
  holdExpiresAt?: Date | null
  wooOrderId?: number | null
  studentNotes?: string
  actor?: string
  notify?: boolean
  now?: Date
}

export interface BookingResult {
  booking: BookingDoc
  session: SessionDoc
  student: StudentDoc
  courseType: CourseTypeDoc
  pkg: PackageDoc | null
}

async function loadContext(sessionId: Types.ObjectId | string, studentId: Types.ObjectId | string) {
  const [session, student] = await Promise.all([
    SessionModel.findById(sessionId),
    StudentModel.findById(studentId),
  ])
  if (!session) throw new NotFoundError('Class')
  if (!student) throw new NotFoundError('Student')

  const courseType = await CourseTypeModel.findById(session.courseTypeId)
  if (!courseType) throw new NotFoundError('Course')

  return { session, student, courseType }
}

/**
 * Give a student a place.
 *
 * Order matters. The seat is claimed first because it is the resource students actually compete
 * for; a credit that was spent can be handed straight back, but a seat sold twice cannot be
 * un-sold. Everything after the seat compensates on failure.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const now = input.now ?? new Date()
  const {
    source = 'student_web',
    status = 'confirmed',
    usePackage = true,
    overrideCapacity = false,
    actor = 'system',
    notify = true,
  } = input

  const { session, student, courseType } = await loadContext(input.sessionId, input.studentId)

  // Cheap pre-checks for a clear error message. The authoritative capacity check is the
  // atomic reservation below — this one can go stale between here and there, which is fine.
  if (!overrideCapacity) {
    const verdict = evaluateSessionBookable(session, now)
    if (!verdict.allowed) throw ruleError(verdict.code, verdict.message)
  }

  const existing = await BookingModel.findOne({
    sessionId: session._id,
    studentId: student._id,
    status: { $in: ['hold', 'confirmed'] },
  })
  if (existing) {
    throw new ConflictError('already_booked', 'You already have a place in this class.')
  }

  // 1. Claim the seat. Throws if the class filled up in the meantime.
  const reservedSession = await reserveSeat(session._id, { override: overrideCapacity })

  let pkg: PackageDoc | null = null
  let booking: BookingDoc | null = null

  try {
    // 2. Spend a course credit, for IFDA and Preserved Flower.
    if (usePackage && courseType.bookingMode === 'package') {
      const usable = await findUsablePackage(student._id, courseType._id, now)
      if (!usable) {
        throw new AppError(
          422,
          'no_package',
          `${student.name} does not have an active ${courseType.name} course package with sessions remaining.`,
        )
      }
      pkg = await consumeSession(usable._id, { by: actor, note: `Booked ${session.title || courseType.name}` })
    }

    // 3. Record the booking.
    booking = await BookingModel.create({
      sessionId: session._id,
      studentId: student._id,
      status,
      source,
      packageId: pkg?._id ?? null,
      holdToken: input.holdToken ?? null,
      holdExpiresAt: input.holdExpiresAt ?? null,
      wooOrderId: input.wooOrderId ?? null,
      studentNotes: input.studentNotes ?? '',
      capacityOverridden: overrideCapacity,
      confirmedAt: status === 'confirmed' ? now : null,
    })

    if (pkg) {
      await PackageModel.updateOne(
        { _id: pkg._id, 'ledger.bookingId': null, 'ledger.type': 'consume' },
        { $set: { 'ledger.$.bookingId': booking._id } },
      )
    }
  } catch (err) {
    // Undo in reverse. The seat must go back or the class silently loses a place forever.
    if (pkg) {
      await restoreSession(pkg._id, { by: actor, note: 'Booking failed — session returned' }).catch((e) =>
        logger.error({ err: e, packageId: String(pkg!._id) }, 'Failed to return course session after booking error'),
      )
    }
    await releaseSeat(session._id).catch((e) =>
      logger.error({ err: e, sessionId: String(session._id) }, 'Failed to release seat after booking error'),
    )
    throw err
  }

  const freshSession = await SessionModel.findById(session._id)
  const result: BookingResult = {
    booking,
    session: freshSession ?? reservedSession,
    student,
    courseType,
    pkg,
  }

  await recordAudit({
    actor,
    action: overrideCapacity ? 'booking.create.override' : 'booking.create',
    entity: 'Booking',
    entityId: booking._id,
    after: { sessionId: String(session._id), studentId: String(student._id), status, source },
  })

  if (notify && status === 'confirmed') {
    await notifyBookingCreated(result)
  }

  return result
}

/** Confirmation to the student, alert to the studio. Failures here must never undo a valid booking. */
export async function notifyBookingCreated(result: BookingResult): Promise<void> {
  const ctx = {
    booking: result.booking,
    session: result.session,
    courseType: result.courseType,
    student: result.student,
    pkg: result.pkg,
  }
  try {
    await queueBookingConfirmation(ctx)
    await queueAdminNewBooking(ctx)
  } catch (err) {
    logger.error({ err, bookingId: String(result.booking._id) }, 'Failed to queue booking notifications')
  }
}

export interface CancelBookingInput {
  bookingId: Types.ObjectId | string
  reason?: string
  by?: string
  /** Students are held to the course cutoff; the studio is not. */
  enforceCutoff?: boolean
  notify?: boolean
  now?: Date
}

export async function cancelBooking(input: CancelBookingInput): Promise<BookingResult> {
  const now = input.now ?? new Date()
  const { reason = '', by = 'system', enforceCutoff = false, notify = true } = input

  const booking = await BookingModel.findById(input.bookingId)
  if (!booking) throw new NotFoundError('Booking')
  if (booking.status === 'cancelled') {
    throw new ConflictError('already_cancelled', 'This booking has already been cancelled.')
  }

  const { session, student, courseType } = await loadContext(booking.sessionId, booking.studentId)

  if (enforceCutoff) {
    const verdict = evaluateCancel({ booking, session, courseType }, now)
    if (!verdict.allowed) throw ruleError(verdict.code, verdict.message)
  }

  booking.status = 'cancelled'
  booking.cancelledAt = now
  booking.cancelReason = reason
  booking.cancelledBy = by
  await booking.save()

  await releaseSeat(session._id)

  let pkg: PackageDoc | null = null
  if (booking.packageId) {
    await restoreSession(booking.packageId, {
      bookingId: booking._id,
      by,
      note: reason || 'Booking cancelled',
    })
    pkg = await PackageModel.findById(booking.packageId)
  }

  const freshSession = await SessionModel.findById(session._id)
  const result: BookingResult = { booking, session: freshSession ?? session, student, courseType, pkg }

  await recordAudit({
    actor: by,
    action: 'booking.cancel',
    entity: 'Booking',
    entityId: booking._id,
    reason,
    before: { status: 'confirmed' },
    after: { status: 'cancelled' },
  })

  if (notify) {
    try {
      await queueBookingCancelled(result)
      await queueAdminBookingChange(result, 'cancelled')
    } catch (err) {
      logger.error({ err, bookingId: String(booking._id) }, 'Failed to queue cancellation notifications')
    }
  }

  return result
}

export interface RescheduleInput {
  bookingId: Types.ObjectId | string
  toSessionId: Types.ObjectId | string
  by?: string
  /** Students are held to the 24h/72h rule; the studio can move anyone at any time. */
  enforceCutoff?: boolean
  overrideCapacity?: boolean
  notify?: boolean
  now?: Date
}

/**
 * Move a student to a different class.
 *
 * The old booking is cancelled and a new one created rather than the date being edited in place,
 * so the studio can see that a student moved and where from. The course credit carries across —
 * moving a booking must never cost a second session.
 */
export async function rescheduleBooking(input: RescheduleInput): Promise<BookingResult> {
  const now = input.now ?? new Date()
  const { by = 'system', enforceCutoff = true, overrideCapacity = false, notify = true } = input

  const booking = await BookingModel.findById(input.bookingId)
  if (!booking) throw new NotFoundError('Booking')

  const { session: fromSession, student, courseType } = await loadContext(booking.sessionId, booking.studentId)

  const toSession = await SessionModel.findById(input.toSessionId)
  if (!toSession) throw new NotFoundError('Class')

  if (String(toSession._id) === String(fromSession._id)) {
    throw new ConflictError('same_session', 'That is the class this booking is already in.')
  }

  // Moving between courses would make the course credit and the price meaningless.
  if (String(toSession.courseTypeId) !== String(fromSession.courseTypeId)) {
    throw new AppError(
      422,
      'course_mismatch',
      `This booking can only be moved to another ${courseType.name} class.`,
    )
  }

  if (enforceCutoff) {
    const verdict = evaluateReschedule({ booking, session: fromSession, courseType }, now)
    if (!verdict.allowed) throw ruleError(verdict.code, verdict.message)
  }

  if (!overrideCapacity) {
    const targetVerdict = evaluateSessionBookable(toSession, now)
    if (!targetVerdict.allowed) throw ruleError(targetVerdict.code, targetVerdict.message)
  }

  const duplicate = await BookingModel.findOne({
    sessionId: toSession._id,
    studentId: student._id,
    status: { $in: ['hold', 'confirmed'] },
  })
  if (duplicate) {
    throw new ConflictError('already_booked', 'You already have a place in that class.')
  }

  const previous = { startAt: fromSession.startAt, endAt: fromSession.endAt }

  // Claim the new place before giving up the old one. The other order would briefly free the
  // student's current place, and if the target turned out to be full they would have neither.
  await reserveSeat(toSession._id, { override: overrideCapacity })

  let newBooking: BookingDoc
  try {
    newBooking = await BookingModel.create({
      sessionId: toSession._id,
      studentId: student._id,
      status: 'confirmed',
      source: booking.source,
      // The same credit moves across — a reschedule never costs a second session.
      packageId: booking.packageId,
      wooOrderId: booking.wooOrderId,
      studentNotes: booking.studentNotes,
      rescheduledFrom: booking._id,
      capacityOverridden: overrideCapacity,
      confirmedAt: now,
    })
  } catch (err) {
    await releaseSeat(toSession._id).catch(() => undefined)
    throw err
  }

  booking.status = 'cancelled'
  booking.cancelledAt = now
  booking.cancelReason = 'Rescheduled'
  booking.cancelledBy = by
  // Detached from the credit so the cancel path does not hand back a session the new booking holds.
  booking.packageId = null
  await booking.save()

  await releaseSeat(fromSession._id)

  const [freshTarget, pkg] = await Promise.all([
    SessionModel.findById(toSession._id),
    newBooking.packageId ? PackageModel.findById(newBooking.packageId) : Promise.resolve(null),
  ])

  const result: BookingResult = {
    booking: newBooking,
    session: freshTarget ?? toSession,
    student,
    courseType,
    pkg,
  }

  await recordAudit({
    actor: by,
    action: enforceCutoff ? 'booking.reschedule' : 'booking.reschedule.override',
    entity: 'Booking',
    entityId: newBooking._id,
    before: { sessionId: String(fromSession._id), startAt: previous.startAt },
    after: { sessionId: String(toSession._id), startAt: toSession.startAt },
  })

  if (notify) {
    try {
      await queueRescheduleConfirmation(result, previous)
      await queueAdminBookingChange(result, 'rescheduled')
    } catch (err) {
      logger.error({ err, bookingId: String(newBooking._id) }, 'Failed to queue reschedule notifications')
    }
  }

  return result
}

/** Turn a paid hold into a confirmed place once WooCommerce reports the money arrived. */
export async function confirmHold(bookingId: Types.ObjectId | string, wooOrderId?: number): Promise<BookingResult> {
  const booking = await BookingModel.findById(bookingId)
  if (!booking) throw new NotFoundError('Booking')

  if (booking.status === 'confirmed') {
    const ctx = await loadContext(booking.sessionId, booking.studentId)
    return { booking, ...ctx, pkg: null }
  }
  if (booking.status !== 'hold') {
    throw new ConflictError('not_a_hold', 'That booking is no longer awaiting payment.')
  }

  booking.status = 'confirmed'
  booking.confirmedAt = new Date()
  booking.holdExpiresAt = null
  if (wooOrderId) booking.wooOrderId = wooOrderId
  await booking.save()

  const ctx = await loadContext(booking.sessionId, booking.studentId)
  const result: BookingResult = { booking, ...ctx, pkg: null }

  await notifyBookingCreated(result)
  return result
}

/** Places a student is holding or has confirmed, soonest first — the "My bookings" list. */
export async function listStudentBookings(studentId: Types.ObjectId | string, opts: { includePast?: boolean } = {}) {
  const bookings = await BookingModel.find({
    studentId,
    status: { $in: ['hold', 'confirmed', 'attended'] },
  }).lean()

  // Left unpopulated: callers resolve courses themselves in one query, and populating here
  // would replace the course id with a document, breaking the shared session serialiser.
  const sessions = await SessionModel.find({ _id: { $in: bookings.map((b) => b.sessionId) } }).lean()

  const sessionById = new Map(sessions.map((s) => [String(s._id), s]))
  const now = new Date()

  return bookings
    .map((b) => ({ booking: b, session: sessionById.get(String(b.sessionId)) }))
    .filter((row): row is { booking: (typeof bookings)[number]; session: (typeof sessions)[number] } => Boolean(row.session))
    .filter((row) => opts.includePast || row.session.startAt >= now)
    .sort((a, b) => a.session.startAt.getTime() - b.session.startAt.getTime())
}

export const HOLD_TTL_MS = config.HOLD_TTL_MINUTES * 60_000
