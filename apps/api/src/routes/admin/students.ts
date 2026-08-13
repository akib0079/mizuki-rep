import { Router } from 'express'
import { z } from 'zod'
import {
  adminAddBookingSchema,
  packageAdjustSchema,
  packageGrantSchema,
  sessionsRemaining,
  studentInputSchema,
  objectIdSchema,
} from '@mizuki/shared'
import { BookingModel, CourseTypeModel, PackageModel, SessionModel, StudentModel } from '../../models/index.js'
import { cancelBooking, createBooking } from '../../services/bookingService.js'
import { adjustPackage, grantSessions, summarisePackages } from '../../services/packageService.js'
import { recordAudit } from '../../services/auditService.js'
import { findDuplicateGroups, mergeStudents } from '../../services/mergeStudents.js'
import { actorOf } from '../../middleware/auth.js'
import { asyncRoute } from '../../middleware/errorHandler.js'
import { AppError, NotFoundError } from '../../errors.js'

/**
 * Students and their course packages.
 *
 * This is where the studio seats the people who book over chat, and where "you can see what's
 * left and add more sessions or more time whenever a student needs it" actually happens.
 */
export const adminStudentsRouter: Router = Router()

adminStudentsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { search, limit, missingPhone } = z
      .object({
        search: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
        missingPhone: z.coerce.boolean().optional(),
      })
      .parse(req.query)

    const query = search
      ? {
          $or: [
            { name: { $regex: escapeRegex(search), $options: 'i' } },
            { email: { $regex: escapeRegex(search), $options: 'i' } },
            { phone: { $regex: escapeRegex(search), $options: 'i' } },
            // Searchable by reference, since that is the thing the studio will be given when
            // someone rings up about "MZ-0042" rather than a name that matches three people.
            { reference: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        }
      : {}

    /*
     * Students with no contact number — chased from the dashboard.
     *
     * Combined with $and rather than by spreading: a search already uses $or, and a second $or
     * on the same object would silently replace it, quietly ignoring what was typed.
     */
    const noPhone = { $or: [{ phone: '' }, { phone: null }] }
    const filter = missingPhone
      ? search
        ? { $and: [query, noPhone] }
        : noPhone
      : query

    /*
     * Merged records are kept so the audit trail resolves, but they are not people any more —
     * showing them here would put the duplicates straight back in front of the studio.
     */
    const students = await StudentModel.find({ $and: [filter, { mergedInto: null }] })
      .sort({ name: 1 })
      .limit(limit)
      .lean()

    // One aggregate rather than a query per student — the list must stay fast as the studio grows.
    const packages = await PackageModel.find({
      studentId: { $in: students.map((s) => s._id) },
      status: 'active',
    }).lean()

    const remainingByStudent = new Map<string, number>()
    for (const pkg of packages) {
      const key = String(pkg.studentId)
      remainingByStudent.set(key, (remainingByStudent.get(key) ?? 0) + sessionsRemaining(pkg))
    }

    res.json({
      students: students.map((s) => ({
        id: String(s._id),
        reference: s.reference ?? '',
        name: s.name,
        email: s.email,
        phone: s.phone,
        sessionsRemaining: remainingByStudent.get(String(s._id)) ?? 0,
      })),
    })
  }),
)

/*
 * Declared before `/:id`, and it has to stay there.
 *
 * Express matches in declaration order, so with `/:id` first this route was unreachable: every
 * request for it arrived as a student whose id was the word "duplicates", and Mongoose threw
 * casting it to an ObjectId. The panel returned a 500 and the studio simply never saw it.
 */
adminStudentsRouter.get(
  '/duplicates',
  asyncRoute(async (_req, res) => {
    res.json({ groups: await findDuplicateGroups() })
  }),
)

adminStudentsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const student = await StudentModel.findById(req.params.id)
    if (!student) throw new NotFoundError('Student')

    const bookings = await BookingModel.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(100).lean()
    const sessions = await SessionModel.find({ _id: { $in: bookings.map((b) => b.sessionId) } }).lean()
    const sessionById = new Map(sessions.map((s) => [String(s._id), s]))
    const courses = await CourseTypeModel.find().lean()
    const courseById = new Map(courses.map((c) => [String(c._id), c]))

    /*
     * A full picture rather than a name and an email. When the studio has someone on the phone
     * the questions are "has she been before", "did she turn up last time", "how many sessions
     * has she got left" — so attendance history and lifetime counts belong here, not just
     * contact details.
     */
    const packageSummaries = await summarisePackages(student._id)

    const now = new Date()
    const active = bookings.filter((b) => b.status !== 'cancelled')
    const attended = bookings.filter((b) => b.status === 'attended').length
    const noShows = bookings.filter((b) => b.status === 'no_show').length
    const cancelled = bookings.filter((b) => b.status === 'cancelled').length
    const past = active.filter((b) => {
      const s = sessionById.get(String(b.sessionId))
      return s && s.startAt < now
    })

    const attendedOrPast = attended + noShows
    const firstBooking = [...bookings].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0]

    // Which courses this student actually does, most-booked first.
    const courseTally = new Map<string, number>()
    for (const booking of active) {
      const session = sessionById.get(String(booking.sessionId))
      if (!session) continue
      const key = String(session.courseTypeId)
      courseTally.set(key, (courseTally.get(key) ?? 0) + 1)
    }
    const coursesTaken = [...courseTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ courseName: courseById.get(id)?.name ?? '—', count }))

    res.json({
      student: {
        id: String(student._id),
        reference: student.reference ?? '',
        name: student.name,
        email: student.email,
        phone: student.phone,
        notes: student.notes,
        marketingOptIn: student.marketingOptIn,
        lastLoginAt: student.lastLoginAt,
        wooCustomerId: student.wooCustomerId,
        joinedAt: student.createdAt,
        firstBookedAt: firstBooking?.createdAt ?? null,
      },
      stats: {
        totalBookings: active.length,
        upcoming: active.length - past.length,
        attended,
        noShows,
        cancelled,
        // Only meaningful once some classes have actually happened.
        attendanceRate: attendedOrPast > 0 ? Math.round((attended / attendedOrPast) * 100) : null,
        sessionsRemaining: packageSummaries
          .filter((p) => p.status === 'active')
          .reduce((sum, p) => sum + p.remaining, 0),
      },
      coursesTaken,
      packages: packageSummaries.map((p) => ({
        ...p,
        courseName: courseById.get(p.courseTypeId)?.name ?? '',
      })),
      bookings: bookings.map((b) => {
        const session = sessionById.get(String(b.sessionId))
        return {
          id: String(b._id),
          status: b.status,
          source: b.source,
          usedPackage: b.packageId !== null,
          capacityOverridden: b.capacityOverridden,
          notes: b.studentNotes,
          adminNotes: b.adminNotes,
          bookedAt: b.createdAt,
          cancelledAt: b.cancelledAt,
          cancelReason: b.cancelReason,
          wooOrderId: b.wooOrderId,
          session: session
            ? {
                id: String(session._id),
                title: session.title,
                startAt: session.startAt.toISOString(),
                endAt: session.endAt.toISOString(),
                dateKey: session.dateKey,
                status: session.status,
                courseName: courseById.get(String(session.courseTypeId))?.name ?? '',
                colour: courseById.get(String(session.courseTypeId))?.colour ?? '#94a3b8',
              }
            : null,
        }
      }),
    })
  }),
)

adminStudentsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const input = studentInputSchema.parse(req.body)

    const existing = await StudentModel.findOne({ email: input.email })
    if (existing) {
      throw new AppError(409, 'duplicate_email', `${input.email} is already on file as ${existing.name}.`)
    }

    const student = await StudentModel.create(input)
    res.status(201).json({ student: { id: String(student._id), name: student.name, email: student.email } })
  }),
)

adminStudentsRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const input = studentInputSchema.partial().parse(req.body)
    const student = await StudentModel.findByIdAndUpdate(req.params.id, { $set: input }, { new: true })
    if (!student) throw new NotFoundError('Student')
    res.json({ student: { id: String(student._id), name: student.name, email: student.email } })
  }),
)

/**
 * Seat a student the studio arranged over chat.
 *
 * "For students who book with you over chat, you can either add them yourself or press a minus
 * button to hold places back." This is the first half of that.
 */
adminStudentsRouter.post(
  '/bookings',
  asyncRoute(async (req, res) => {
    const input = adminAddBookingSchema.parse(req.body)

    let studentId = input.studentId
    if (!studentId) {
      if (!input.student) {
        throw new AppError(400, 'student_required', 'Pick an existing student or enter their details.')
      }
      // Match on email first so the studio does not end up with two records for one person.
      const existing = await StudentModel.findOne({ email: input.student.email })
      studentId = String(existing?._id ?? (await StudentModel.create(input.student))._id)
    }

    const result = await createBooking({
      sessionId: input.sessionId,
      studentId,
      source: 'admin_manual',
      usePackage: input.usePackage,
      overrideCapacity: input.overrideCapacity,
      actor: actorOf(req),
    })

    res.status(201).json({
      booking: { id: String(result.booking._id), status: result.booking.status },
      seatsLeft: result.session.capacity - result.session.heldBack - result.session.seatsTaken,
      packageRemaining: result.pkg ? sessionsRemaining(result.pkg) : null,
    })
  }),
)

/** Remove a student from a class. The studio is not held to the student notice period. */
adminStudentsRouter.post(
  '/bookings/:id/cancel',
  asyncRoute(async (req, res) => {
    const { reason } = z.object({ reason: z.string().max(300).default('') }).parse(req.body)

    await cancelBooking({
      bookingId: req.params.id!,
      reason,
      by: actorOf(req),
      enforceCutoff: false,
    })

    res.json({ ok: true })
  }),
)

/** Record who actually turned up. */
adminStudentsRouter.post(
  '/bookings/:id/attendance',
  asyncRoute(async (req, res) => {
    const { status } = z.object({ status: z.enum(['attended', 'no_show', 'confirmed']) }).parse(req.body)

    const booking = await BookingModel.findById(req.params.id)
    if (!booking) throw new NotFoundError('Booking')
    if (booking.status === 'cancelled') {
      throw new AppError(409, 'cancelled', 'That booking was cancelled.')
    }

    booking.status = status
    await booking.save()
    res.json({ ok: true, status })
  }),
)

// --- Course packages --------------------------------------------------------

adminStudentsRouter.post(
  '/packages',
  asyncRoute(async (req, res) => {
    const input = packageGrantSchema.parse(req.body)

    const pkg = await grantSessions({
      studentId: input.studentId,
      courseTypeId: input.courseTypeId,
      totalSessions: input.totalSessions,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      note: input.note,
      by: actorOf(req),
    })

    await recordAudit({
      actor: actorOf(req),
      action: 'package.grant',
      entity: 'Package',
      entityId: pkg._id,
      after: { totalSessions: input.totalSessions, expiresAt: input.expiresAt },
    })

    res.status(201).json({ package: { id: String(pkg._id), totalSessions: pkg.totalSessions } })
  }),
)

/** "Add more sessions or more time whenever a student needs it." */
adminStudentsRouter.patch(
  '/packages/:id',
  asyncRoute(async (req, res) => {
    const input = packageAdjustSchema.parse(req.body)

    const pkg = await adjustPackage(req.params.id!, {
      addSessions: input.addSessions,
      extendToDate: input.extendToDate ? new Date(input.extendToDate) : null,
      note: input.note,
      by: actorOf(req),
    })

    await recordAudit({
      actor: actorOf(req),
      action: 'package.adjust',
      entity: 'Package',
      entityId: pkg._id,
      after: { addSessions: input.addSessions, extendToDate: input.extendToDate },
      reason: input.note,
    })

    res.json({
      package: {
        id: String(pkg._id),
        totalSessions: pkg.totalSessions,
        usedSessions: pkg.usedSessions,
        remaining: sessionsRemaining(pkg),
        expiresAt: pkg.expiresAt,
        status: pkg.status,
      },
    })
  }),
)

adminStudentsRouter.get(
  '/packages/:id/ledger',
  asyncRoute(async (req, res) => {
    const pkg = await PackageModel.findById(req.params.id).lean()
    if (!pkg) throw new NotFoundError('Course package')
    res.json({ ledger: pkg.ledger })
  }),
)

/** User input goes into a regex, so escape it — otherwise a stray "(" is a 500. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Accounts that look like one person.
 *
 * Offered as a screen rather than left to be noticed, because the studio only found their three
 * copies of one student by scrolling the list and recognising the name.
 */
/**
 * Join two accounts.
 *
 * Bookings and course credits move to the account being kept. Nothing is deleted — the other
 * record is emptied and marked, so the audit trail still resolves.
 */
adminStudentsRouter.post(
  '/merge',
  asyncRoute(async (req, res) => {
    const { keepId, mergeId } = z
      .object({ keepId: objectIdSchema, mergeId: objectIdSchema })
      .parse(req.body)

    res.json(await mergeStudents(keepId, mergeId, actorOf(req)))
  }),
)
