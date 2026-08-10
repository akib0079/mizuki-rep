import { Router } from 'express'
import { z } from 'zod'
import { closedDateInputSchema, eachDateKey } from '@mizuki/shared'
import { BookingModel, ClosedDateModel, SessionModel, StudentModel } from '../../models/index.js'
import { recordAudit } from '../../services/auditService.js'
import { actorOf } from '../../middleware/auth.js'
import { asyncRoute } from '../../middleware/errorHandler.js'
import { NotFoundError } from '../../errors.js'

/**
 * Closed days and away periods.
 *
 * "Mark the days you're closed and they disappear from the calendar instantly" — and, because
 * the teacher travels for outside work, marking a whole stretch closed must show exactly who it
 * strands before anything happens. The preview endpoint exists so the admin console can ask
 * "12 students across 6 classes — cancel and tell them?" rather than acting blind.
 */
export const adminClosedDatesRouter: Router = Router()

adminClosedDatesRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    const closed = await ClosedDateModel.find().sort({ startDate: 1 }).lean()
    res.json({
      closedDates: closed.map((c) => ({
        id: String(c._id),
        startDate: c.startDate,
        endDate: c.endDate,
        reason: c.reason,
      })),
    })
  }),
)

/**
 * What would closing this range affect? Read-only — nothing is changed by asking.
 * The admin console calls this before showing the confirmation dialog.
 */
adminClosedDatesRouter.post(
  '/preview',
  asyncRoute(async (req, res) => {
    const { startDate, endDate } = closedDateInputSchema.parse(req.body)

    const sessions = await SessionModel.find({
      dateKey: { $gte: startDate, $lte: endDate },
      status: 'scheduled',
    })
      .sort({ startAt: 1 })
      .lean()

    const bookings = await BookingModel.find({
      sessionId: { $in: sessions.map((s) => s._id) },
      status: { $in: ['hold', 'confirmed'] },
    }).lean()

    const students = await StudentModel.find({ _id: { $in: bookings.map((b) => b.studentId) } })
      .select('name email')
      .lean()
    const studentById = new Map(students.map((s) => [String(s._id), s]))

    const bookingsBySession = new Map<string, typeof bookings>()
    for (const booking of bookings) {
      const key = String(booking.sessionId)
      bookingsBySession.set(key, [...(bookingsBySession.get(key) ?? []), booking])
    }

    res.json({
      days: eachDateKey(startDate, endDate).length,
      sessionCount: sessions.length,
      affectedStudentCount: new Set(bookings.map((b) => String(b.studentId))).size,
      sessions: sessions.map((s) => {
        const rows = bookingsBySession.get(String(s._id)) ?? []
        return {
          id: String(s._id),
          dateKey: s.dateKey,
          title: s.title,
          startAt: s.startAt.toISOString(),
          bookedCount: rows.length,
          students: rows.map((b) => {
            const student = studentById.get(String(b.studentId))
            return { name: student?.name ?? 'Unknown', email: student?.email ?? '' }
          }),
        }
      }),
    })
  }),
)

/**
 * Mark a range closed. Classes on those days drop off the public calendar immediately.
 *
 * Existing bookings are deliberately left alone here — cancelling them is a separate, explicit
 * step through the session cancel endpoint, so a mis-typed date range cannot wipe out a weekend
 * of bookings in one click.
 */
adminClosedDatesRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const input = closedDateInputSchema.parse(req.body)

    const closed = await ClosedDateModel.create({
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
      createdBy: actorOf(req),
    })

    const affected = await SessionModel.countDocuments({
      dateKey: { $gte: input.startDate, $lte: input.endDate },
      status: 'scheduled',
    })

    await recordAudit({
      actor: actorOf(req),
      action: 'closedDate.create',
      entity: 'ClosedDate',
      entityId: closed._id,
      after: { ...input, sessionsHidden: affected },
    })

    res.status(201).json({
      closedDate: { id: String(closed._id), startDate: closed.startDate, endDate: closed.endDate, reason: closed.reason },
      sessionsHidden: affected,
    })
  }),
)

adminClosedDatesRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const closed = await ClosedDateModel.findById(req.params.id)
    if (!closed) throw new NotFoundError('Closed date')

    await ClosedDateModel.deleteOne({ _id: closed._id })
    await recordAudit({
      actor: actorOf(req),
      action: 'closedDate.delete',
      entity: 'ClosedDate',
      entityId: closed._id,
      before: { startDate: closed.startDate, endDate: closed.endDate },
    })

    res.json({ ok: true })
  }),
)

/** Quick check used by the calendar UI when the admin picks a date. */
adminClosedDatesRouter.get(
  '/check',
  asyncRoute(async (req, res) => {
    const { date } = z.object({ date: z.string() }).parse(req.query)
    const hit = await ClosedDateModel.findOne({ startDate: { $lte: date }, endDate: { $gte: date } }).lean()
    res.json({ closed: hit !== null, reason: hit?.reason ?? null })
  }),
)
