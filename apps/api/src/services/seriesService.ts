import { Types } from 'mongoose'
import { evaluateSessionBookable, formatSessionDateTime, seatsLeft } from '@mizuki/shared'
import {
  BookingModel,
  CourseSeriesModel,
  CourseTypeModel,
  SessionModel,
  StudentModel,
  type BookingDoc,
  type CourseSeriesDoc,
} from '../models/index.js'
import { releaseSeat, reserveSeat } from './seatService.js'
import { queueMessage } from './notificationService.js'
import { recordAudit } from './auditService.js'
import { AppError, ConflictError, NotFoundError, SessionFullError } from '../errors.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Booking a whole course at once.
 *
 * The awkward property here is that a partial booking is worse than no booking. A student who
 * ends up on days one, two and four of a four-day Ikebana course has bought something that does
 * not work, and the studio has to unpick it by hand. So this claims every place before it
 * commits to any of them, and gives them all back if even one is unavailable.
 */

export interface SeriesAvailability {
  seriesId: string
  name: string
  courseTypeId: string
  bookable: boolean
  /** The binding constraint: the fewest places free across every date in the course. */
  placesLeft: number
  reason: string
  sessions: {
    id: string
    title: string
    startAt: string
    seatsLeft: number
    isFull: boolean
    isPast: boolean
  }[]
}

export async function getSeriesAvailability(
  seriesId: Types.ObjectId | string,
  now: Date = new Date(),
): Promise<SeriesAvailability> {
  const series = await CourseSeriesModel.findById(seriesId)
  if (!series) throw new NotFoundError('Course')

  const sessions = await SessionModel.find({ _id: { $in: series.sessionIds } }).sort({ startAt: 1 })

  const rows = sessions.map((s) => {
    const verdict = evaluateSessionBookable(s, now)
    return {
      id: String(s._id),
      title: s.title,
      startAt: s.startAt.toISOString(),
      seatsLeft: seatsLeft(s),
      isFull: seatsLeft(s) === 0,
      isPast: s.startAt.getTime() <= now.getTime(),
      allowed: verdict.allowed,
      message: verdict.message,
    }
  })

  const blocked = rows.find((r) => !r.allowed)
  // The course can only take as many students as its tightest date allows.
  const placesLeft = rows.length > 0 ? Math.min(...rows.map((r) => r.seatsLeft)) : 0

  return {
    seriesId: String(series._id),
    name: series.name,
    courseTypeId: String(series.courseTypeId),
    bookable: series.active && rows.length > 0 && !blocked,
    placesLeft,
    reason: !series.active
      ? 'This course is no longer on offer.'
      : rows.length === 0
        ? 'This course has no dates set yet.'
        : blocked
          ? blocked.isPast
            ? 'This course has already started.'
            : `${blocked.title} on ${formatSessionDateTime(new Date(blocked.startAt)).split(',')[0]} is full, so the course cannot be booked.`
          : '',
    sessions: rows.map(({ allowed: _allowed, message: _message, ...rest }) => rest),
  }
}

export interface BookSeriesResult {
  series: CourseSeriesDoc
  bookings: BookingDoc[]
}

/**
 * Book every date in a course for one student, or none of them.
 *
 * Places are claimed one at a time because that is the only way the atomic capacity guard works,
 * so the rollback below is what turns several independent claims into one all-or-nothing act.
 */
export async function bookSeries(input: {
  seriesId: Types.ObjectId | string
  studentId: Types.ObjectId | string
  source?: 'student_web' | 'admin_manual' | 'woo_order'
  wooOrderId?: number | null
  actor?: string
  overrideCapacity?: boolean
  now?: Date
}): Promise<BookSeriesResult> {
  const now = input.now ?? new Date()
  const { source = 'woo_order', actor = 'system', overrideCapacity = false } = input

  const series = await CourseSeriesModel.findById(input.seriesId)
  if (!series) throw new NotFoundError('Course')
  if (!series.active) throw new AppError(422, 'series_inactive', 'This course is no longer on offer.')
  if (series.sessionIds.length === 0) {
    throw new AppError(422, 'series_empty', 'This course has no dates set yet.')
  }

  const student = await StudentModel.findById(input.studentId)
  if (!student) throw new NotFoundError('Student')

  const courseType = await CourseTypeModel.findById(series.courseTypeId)
  if (!courseType) throw new NotFoundError('Course')

  const existing = await BookingModel.findOne({
    sessionId: { $in: series.sessionIds },
    studentId: student._id,
    status: { $in: ['hold', 'confirmed'] },
  })
  if (existing) {
    throw new ConflictError('already_booked', `${student.name} already has a place on one of this course's dates.`)
  }

  const claimedSessions: Types.ObjectId[] = []
  const bookings: BookingDoc[] = []

  try {
    for (const sessionId of series.sessionIds) {
      await reserveSeat(sessionId, { override: overrideCapacity })
      claimedSessions.push(sessionId)

      const booking = await BookingModel.create({
        sessionId,
        studentId: student._id,
        status: 'confirmed',
        source,
        wooOrderId: input.wooOrderId ?? null,
        capacityOverridden: overrideCapacity,
        confirmedAt: now,
        adminNotes: `Part of ${series.name}`,
      })
      bookings.push(booking)
    }
  } catch (err) {
    // Unwind everything. A student on three of four dates is worse than a clean failure.
    for (const booking of bookings) {
      await BookingModel.deleteOne({ _id: booking._id }).catch(() => undefined)
    }
    for (const sessionId of claimedSessions) {
      await releaseSeat(sessionId).catch((e) =>
        logger.error({ err: e, sessionId: String(sessionId) }, 'Failed to release a place after a course booking failed'),
      )
    }

    if (err instanceof SessionFullError) {
      throw new AppError(
        409,
        'series_full',
        `One of the dates in ${series.name} is full, so the course cannot be booked. Nothing has been reserved.`,
      )
    }
    throw err
  }

  await recordAudit({
    actor,
    action: 'series.book',
    entity: 'CourseSeries',
    entityId: series._id,
    after: { studentId: String(student._id), sessions: series.sessionIds.length, wooOrderId: input.wooOrderId ?? null },
  })

  await notifySeriesBooked(series, student, bookings)

  return { series, bookings }
}

async function notifySeriesBooked(
  series: CourseSeriesDoc,
  student: { _id: unknown; name: string; email: string },
  bookings: BookingDoc[],
): Promise<void> {
  const sessions = await SessionModel.find({ _id: { $in: bookings.map((b) => b.sessionId) } }).sort({ startAt: 1 })

  const dateLines = sessions.map((s) => `• ${formatSessionDateTime(s.startAt)}`).join('\n')
  const dateHtml = sessions.map((s) => `<li>${formatSessionDateTime(s.startAt)}</li>`).join('')

  await queueMessage('series_confirmation', {
    dedupeKey: `series_confirmation:${series._id}:${student._id}:${bookings[0]?._id}`,
    to: student.email,
    subject: `You're booked on ${series.name}`,
    bodyText: `Hello ${student.name},\n\nYour place on ${series.name} is confirmed. All ${sessions.length} dates are booked for you:\n\n${dateLines}\n\nWe look forward to seeing you.\n\nMizuki Flora`,
    bodyHtml: `<p>Hello ${student.name},</p><p>Your place on <strong>${series.name}</strong> is confirmed. All ${sessions.length} dates are booked for you:</p><ul>${dateHtml}</ul><p>We look forward to seeing you.</p><p>Mizuki Flora</p>`,
  })

  if (config.ADMIN_ALERT_EMAIL) {
    await queueMessage('admin_series_booked', {
      dedupeKey: `admin_series_booked:${series._id}:${student._id}:${bookings[0]?._id}`,
      to: config.ADMIN_ALERT_EMAIL,
      subject: `Course booked: ${student.name} — ${series.name}`,
      bodyText: `${student.name} (${student.email}) booked all ${sessions.length} dates of ${series.name}.\n\n${dateLines}`,
      bodyHtml: `<p><strong>${student.name}</strong> (${student.email}) booked all ${sessions.length} dates of ${series.name}.</p><ul>${dateHtml}</ul>`,
    })
  }
}

/** Cancel a student off every date of a course at once. */
export async function cancelSeriesBooking(input: {
  seriesId: Types.ObjectId | string
  studentId: Types.ObjectId | string
  reason?: string
  by?: string
}): Promise<number> {
  const series = await CourseSeriesModel.findById(input.seriesId)
  if (!series) throw new NotFoundError('Course')

  const bookings = await BookingModel.find({
    sessionId: { $in: series.sessionIds },
    studentId: input.studentId,
    status: { $in: ['hold', 'confirmed'] },
  })

  for (const booking of bookings) {
    booking.status = 'cancelled'
    booking.cancelledAt = new Date()
    booking.cancelReason = input.reason ?? `${series.name} cancelled`
    booking.cancelledBy = input.by ?? 'system'
    await booking.save()
    await releaseSeat(booking.sessionId)
  }

  return bookings.length
}

/** Find the course a shop product sells, if any. */
export async function findSeriesByProduct(productId: number): Promise<CourseSeriesDoc | null> {
  return CourseSeriesModel.findOne({ wooProductId: productId, active: true })
}
