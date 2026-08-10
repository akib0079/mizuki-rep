import { Router } from 'express'
import { Types } from 'mongoose'
import { DateTime } from 'luxon'
import {
  STUDIO_TZ,
  adjustHeldBackSchema,
  isOverCapacity,
  seatsLeft,
  sessionCancelSchema,
  sessionCreateSchema,
  sessionUpdateSchema,
  studioInstant,
} from '@mizuki/shared'
import { z } from 'zod'
import {
  BookingModel,
  CourseTypeModel,
  SessionModel,
  StudentModel,
  type SessionDoc,
} from '../../models/index.js'
import { createAdHocSession } from '../../services/scheduleService.js'
import { queueSessionCancelled, queueSessionMoved } from '../../services/notificationService.js'
import { releaseSeat } from '../../services/seatService.js'
import { restoreSession } from '../../services/packageService.js'
import { recordAudit } from '../../services/auditService.js'
import { actorOf } from '../../middleware/auth.js'
import { asyncRoute } from '../../middleware/errorHandler.js'
import { AppError, NotFoundError } from '../../errors.js'
import { logger } from '../../logger.js'

/**
 * Managing the timetable: "The ability to easily add, delete, or reschedule sessions on my calendar."
 *
 * Anything that changes a class students are already booked into tells the admin exactly who is
 * affected before it happens, and offers to email them. Nothing here silently strands a student.
 */
export const adminSessionsRouter: Router = Router()

/** The admin calendar feed — unlike the public one, this includes cancelled and full classes. */
adminSessionsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { from, to, courseTypeId } = z
      .object({
        from: z.string(),
        to: z.string(),
        courseTypeId: z.string().optional(),
      })
      .parse(req.query)

    const query: Record<string, unknown> = { dateKey: { $gte: from, $lte: to } }
    if (courseTypeId) query.courseTypeId = new Types.ObjectId(courseTypeId)

    const sessions = await SessionModel.find(query).sort({ startAt: 1 }).lean()
    const courses = await CourseTypeModel.find().lean()
    const courseById = new Map(courses.map((c) => [String(c._id), c]))

    res.json({
      sessions: sessions.map((s) => {
        const course = courseById.get(String(s.courseTypeId))
        return {
          id: String(s._id),
          courseTypeId: String(s.courseTypeId),
          courseName: course?.name ?? 'Unknown course',
          colour: course?.colour ?? '#999999',
          title: s.title || course?.name || '',
          startAt: s.startAt.toISOString(),
          endAt: s.endAt.toISOString(),
          dateKey: s.dateKey,
          capacity: s.capacity,
          heldBack: s.heldBack,
          seatsTaken: s.seatsTaken,
          seatsLeft: seatsLeft(s),
          overCapacity: isOverCapacity(s),
          status: s.status,
          isRecurring: s.scheduleRuleId !== null,
          breaks: s.breaks,
          notes: s.notes,
        }
      }),
    })
  }),
)

/** One class with its roster — who is coming, and how they booked. */
adminSessionsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const session = await SessionModel.findById(req.params.id)
    if (!session) throw new NotFoundError('Class')

    const course = await CourseTypeModel.findById(session.courseTypeId)
    const bookings = await BookingModel.find({
      sessionId: session._id,
      status: { $in: ['hold', 'confirmed', 'attended', 'no_show'] },
    })
      .sort({ createdAt: 1 })
      .lean()

    const students = await StudentModel.find({ _id: { $in: bookings.map((b) => b.studentId) } }).lean()
    const studentById = new Map(students.map((s) => [String(s._id), s]))

    res.json({
      session: {
        id: String(session._id),
        courseTypeId: String(session.courseTypeId),
        courseName: course?.name ?? '',
        title: session.title,
        startAt: session.startAt.toISOString(),
        endAt: session.endAt.toISOString(),
        dateKey: session.dateKey,
        capacity: session.capacity,
        heldBack: session.heldBack,
        seatsTaken: session.seatsTaken,
        seatsLeft: seatsLeft(session),
        overCapacity: isOverCapacity(session),
        status: session.status,
        notes: session.notes,
        breaks: session.breaks,
        isRecurring: session.scheduleRuleId !== null,
      },
      roster: bookings.map((b) => {
        const student = studentById.get(String(b.studentId))
        return {
          bookingId: String(b._id),
          studentId: String(b.studentId),
          name: student?.name ?? 'Unknown',
          email: student?.email ?? '',
          phone: student?.phone ?? '',
          status: b.status,
          source: b.source,
          usedPackage: b.packageId !== null,
          capacityOverridden: b.capacityOverridden,
          notes: b.studentNotes,
          bookedAt: b.createdAt,
        }
      }),
    })
  }),
)

/** Add a one-off class. */
adminSessionsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const input = sessionCreateSchema.parse(req.body)

    const course = await CourseTypeModel.findById(input.courseTypeId)
    if (!course) throw new NotFoundError('Course')

    const session = await createAdHocSession({
      courseTypeId: input.courseTypeId,
      dateKey: input.date,
      startTime: input.startTime,
      durationMins: input.durationMins,
      capacity: input.capacity,
      title: input.title || course.name,
      notes: input.notes,
      breaks: input.breaks,
    })

    await recordAudit({
      actor: actorOf(req),
      action: 'session.create',
      entity: 'Session',
      entityId: session._id,
      after: { dateKey: input.date, startTime: input.startTime, capacity: input.capacity },
    })

    res.status(201).json({ session: { id: String(session._id) } })
  }),
)

/**
 * Edit a class — including dragging it to a new day or time on the calendar.
 *
 * Students booked into it are emailed by default whenever the time actually moves; the admin can
 * opt out for a correction nobody needs to hear about.
 */
adminSessionsRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const input = sessionUpdateSchema.parse(req.body)
    const session = await SessionModel.findById(req.params.id)
    if (!session) throw new NotFoundError('Class')

    const previous = { startAt: session.startAt, endAt: session.endAt, capacity: session.capacity }
    const overridden = new Set(session.overriddenFields)

    const durationMins =
      input.durationMins ?? Math.round((session.endAt.getTime() - session.startAt.getTime()) / 60_000)

    let timeChanged = false
    if (input.date || input.startTime || input.durationMins) {
      // Anything the caller did not send keeps its current value, so dragging a class to a new
      // day on the calendar moves it without also resetting its start time or length.
      const dateKey = input.date ?? session.dateKey
      const startTime = input.startTime ?? formatStudioTime(session.startAt)

      const startAt = studioInstant(dateKey, startTime)
      const endAt = new Date(startAt.getTime() + durationMins * 60_000)

      timeChanged = startAt.getTime() !== session.startAt.getTime() || endAt.getTime() !== session.endAt.getTime()

      session.startAt = startAt
      session.endAt = endAt
      session.dateKey = dateKey
      if (timeChanged) {
        overridden.add('startAt')
        overridden.add('endAt')
      }
    }

    if (input.capacity !== undefined && input.capacity !== session.capacity) {
      session.capacity = input.capacity
      overridden.add('capacity')
    }
    if (input.heldBack !== undefined) {
      session.heldBack = input.heldBack
      overridden.add('heldBack')
    }
    if (input.title !== undefined) session.title = input.title
    if (input.notes !== undefined) session.notes = input.notes
    if (input.breaks !== undefined) session.set('breaks', input.breaks)

    // Remember which fields were touched by hand so rule regeneration leaves them alone.
    session.overriddenFields = [...overridden]
    await session.save()

    const notify = input.notifyStudents ?? timeChanged
    let notified = 0
    if (timeChanged && notify) {
      notified = await notifyRoster(session, async (ctx) => queueSessionMoved(ctx, previous))
    }

    await recordAudit({
      actor: actorOf(req),
      action: 'session.update',
      entity: 'Session',
      entityId: session._id,
      before: previous,
      after: { startAt: session.startAt, endAt: session.endAt, capacity: session.capacity },
    })

    res.json({
      session: {
        id: String(session._id),
        startAt: session.startAt.toISOString(),
        endAt: session.endAt.toISOString(),
        capacity: session.capacity,
        heldBack: session.heldBack,
        seatsLeft: seatsLeft(session),
        overCapacity: isOverCapacity(session),
      },
      studentsNotified: notified,
    })
  }),
)

/**
 * The "minus button": withhold places from public sale, or release them again.
 *
 * Distinct from changing the class size — the room did not get smaller, the studio just wants
 * to keep some places for students who book over chat.
 */
adminSessionsRouter.post(
  '/:id/held-back',
  asyncRoute(async (req, res) => {
    const { delta } = adjustHeldBackSchema.parse(req.body)

    const session = await SessionModel.findById(req.params.id)
    if (!session) throw new NotFoundError('Class')

    const next = session.heldBack + delta
    if (next < 0) {
      throw new AppError(422, 'invalid_held_back', 'There are no held-back places left to release.')
    }
    if (next + session.seatsTaken > session.capacity) {
      throw new AppError(
        422,
        'invalid_held_back',
        `Only ${session.capacity - session.seatsTaken} place(s) are free, so you cannot hold back ${next}.`,
      )
    }

    session.heldBack = next
    await session.save()

    res.json({ heldBack: session.heldBack, seatsLeft: seatsLeft(session) })
  }),
)

/**
 * Cancel a class.
 *
 * Bookings are cancelled with it, places returned, course credits handed back, and — by default —
 * every affected student emailed. A class the studio pulls must never quietly leave someone
 * expecting to turn up.
 */
adminSessionsRouter.post(
  '/:id/cancel',
  asyncRoute(async (req, res) => {
    const input = sessionCancelSchema.parse(req.body)

    const session = await SessionModel.findById(req.params.id)
    if (!session) throw new NotFoundError('Class')
    if (session.status === 'cancelled') {
      throw new AppError(409, 'already_cancelled', 'That class is already cancelled.')
    }

    let notified = 0
    if (input.notifyStudents) {
      notified = await notifyRoster(session, async (ctx) => queueSessionCancelled(ctx, input.reason))
    }

    const bookings = await BookingModel.find({ sessionId: session._id, status: { $in: ['hold', 'confirmed'] } })
    for (const booking of bookings) {
      booking.status = 'cancelled'
      booking.cancelledAt = new Date()
      booking.cancelReason = input.reason || 'Class cancelled by the studio'
      booking.cancelledBy = actorOf(req)
      await booking.save()

      await releaseSeat(session._id)
      if (booking.packageId) {
        await restoreSession(booking.packageId, {
          bookingId: booking._id,
          by: actorOf(req),
          note: 'Class cancelled by the studio',
        })
      }
    }

    session.status = 'cancelled'
    session.cancelledAt = new Date()
    session.cancelReason = input.reason
    await session.save()

    await recordAudit({
      actor: actorOf(req),
      action: 'session.cancel',
      entity: 'Session',
      entityId: session._id,
      reason: input.reason,
      after: { bookingsCancelled: bookings.length },
    })

    res.json({ ok: true, bookingsCancelled: bookings.length, studentsNotified: notified })
  }),
)

/**
 * Delete a class outright. Only allowed while nobody is booked — otherwise the studio must
 * cancel it, which notifies people and returns their credits.
 */
adminSessionsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const session = await SessionModel.findById(req.params.id)
    if (!session) throw new NotFoundError('Class')

    const live = await BookingModel.countDocuments({
      sessionId: session._id,
      status: { $in: ['hold', 'confirmed'] },
    })
    if (live > 0) {
      throw new AppError(
        409,
        'has_bookings',
        `${live} student(s) are booked into this class. Cancel it instead so they are told and refunded their session.`,
      )
    }

    await SessionModel.deleteOne({ _id: session._id })
    await recordAudit({
      actor: actorOf(req),
      action: 'session.delete',
      entity: 'Session',
      entityId: session._id,
      before: { dateKey: session.dateKey, title: session.title },
    })

    res.json({ ok: true })
  }),
)

/** Email everyone booked into a class. Returns how many were reached. */
async function notifyRoster(
  session: SessionDoc,
  send: (ctx: Parameters<typeof queueSessionMoved>[0]) => Promise<void>,
): Promise<number> {
  const bookings = await BookingModel.find({ sessionId: session._id, status: { $in: ['hold', 'confirmed'] } })
  if (bookings.length === 0) return 0

  const [students, courseType] = await Promise.all([
    StudentModel.find({ _id: { $in: bookings.map((b) => b.studentId) } }),
    CourseTypeModel.findById(session.courseTypeId),
  ])
  if (!courseType) return 0
  const studentById = new Map(students.map((s) => [String(s._id), s]))

  let sent = 0
  for (const booking of bookings) {
    const student = studentById.get(String(booking.studentId))
    if (!student) continue
    try {
      await send({ booking, session, courseType, student, pkg: null })
      sent++
    } catch (err) {
      logger.error({ err, bookingId: String(booking._id) }, 'Failed to queue class-change email')
    }
  }
  return sent
}

/** The class's start time as the studio sees it on the wall — "14:30", not a UTC offset. */
function formatStudioTime(date: Date): string {
  return DateTime.fromJSDate(date).setZone(STUDIO_TZ).toFormat('HH:mm')
}
