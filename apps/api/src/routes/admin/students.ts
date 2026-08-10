import { Router } from 'express'
import { z } from 'zod'
import {
  adminAddBookingSchema,
  packageAdjustSchema,
  packageGrantSchema,
  sessionsRemaining,
  studentInputSchema,
} from '@mizuki/shared'
import { BookingModel, CourseTypeModel, PackageModel, SessionModel, StudentModel } from '../../models/index.js'
import { cancelBooking, createBooking } from '../../services/bookingService.js'
import { adjustPackage, grantSessions, summarisePackages } from '../../services/packageService.js'
import { recordAudit } from '../../services/auditService.js'
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
    const { search, limit } = z
      .object({ search: z.string().optional(), limit: z.coerce.number().min(1).max(200).default(50) })
      .parse(req.query)

    const query = search
      ? {
          $or: [
            { name: { $regex: escapeRegex(search), $options: 'i' } },
            { email: { $regex: escapeRegex(search), $options: 'i' } },
            { phone: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        }
      : {}

    const students = await StudentModel.find(query).sort({ name: 1 }).limit(limit).lean()

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
        name: s.name,
        email: s.email,
        phone: s.phone,
        sessionsRemaining: remainingByStudent.get(String(s._id)) ?? 0,
      })),
    })
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

    res.json({
      student: {
        id: String(student._id),
        name: student.name,
        email: student.email,
        phone: student.phone,
        notes: student.notes,
        marketingOptIn: student.marketingOptIn,
        lastLoginAt: student.lastLoginAt,
      },
      packages: (await summarisePackages(student._id)).map((p) => ({
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
          session: session
            ? {
                id: String(session._id),
                title: session.title,
                startAt: session.startAt.toISOString(),
                courseName: courseById.get(String(session.courseTypeId))?.name ?? '',
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
