import { Router } from 'express'
import { z } from 'zod'
import { BookingModel, CourseTypeModel, SessionModel, StudentModel } from '../../models/index.js'
import { ACTIVE_BOOKING_STATUSES, formatSessionDateTime } from '@mizuki/shared'
import {
  clearAllNotifications,
  clearNotifications,
  listNotifications,
  markAllRead,
  markRead,
  markUnread,
  notificationCounts,
  restoreNotifications,
  unreadCount,
} from '../../services/adminNotificationService.js'
import { approveBooking, cancelBooking } from '../../services/bookingService.js'
import { actorOf } from '../../middleware/auth.js'
import { asyncRoute } from '../../middleware/errorHandler.js'
import { AppError, NotFoundError } from '../../errors.js'

/**
 * What the studio needs to look at.
 *
 * The list and the approvals live together because they are the same job: the reason a
 * notification exists is almost always that someone has to decide something, and making them
 * two separate screens is how "3 places awaiting payment" sits there for a week.
 */
export const adminNotificationsRouter: Router = Router()

adminNotificationsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { unread, view, type, limit, skip } = z
      .object({
        /** The bell's older parameter. Kept so an open console mid-deploy keeps working. */
        unread: z.enum(['0', '1']).optional(),
        view: z.enum(['all', 'unread', 'action', 'cleared']).optional(),
        type: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        skip: z.coerce.number().int().min(0).max(5000).optional(),
      })
      .parse(req.query)

    const adminId = req.admin!._id

    const [page, counts, pending] = await Promise.all([
      listNotifications(adminId, {
        view: view ?? (unread === '1' ? 'unread' : 'all'),
        type,
        limit,
        skip,
      }),
      notificationCounts(adminId),
      // Counted from the bookings themselves, not from notifications: if an alert was ever
      // missed or cleared, the work still exists and the badge should still show it.
      BookingModel.countDocuments({ status: 'awaiting_confirmation' }),
    ])

    res.json({
      notifications: page.items,
      hasMore: page.hasMore,
      counts,
      unreadCount: counts.unread,
      awaitingConfirmation: pending,
    })
  }),
)

const idsSchema = z.object({ ids: z.array(z.string()).min(1).max(200) })

adminNotificationsRouter.post(
  '/read',
  asyncRoute(async (req, res) => {
    const { ids } = idsSchema.parse(req.body)
    await markRead(req.admin!._id, ids)
    res.json({ ok: true, unreadCount: await unreadCount(req.admin!._id) })
  }),
)

/** "Not yet" — the console's way of putting something back on the pile. */
adminNotificationsRouter.post(
  '/unread',
  asyncRoute(async (req, res) => {
    const { ids } = idsSchema.parse(req.body)
    await markUnread(req.admin!._id, ids)
    res.json({ ok: true, unreadCount: await unreadCount(req.admin!._id) })
  }),
)

adminNotificationsRouter.post(
  '/read-all',
  asyncRoute(async (req, res) => {
    await markAllRead(req.admin!._id)
    res.json({ ok: true, unreadCount: 0 })
  }),
)

/**
 * Take some off this admin's list.
 *
 * Nothing is deleted and nobody else's list changes — see `clearedBy`. The count comes back so
 * the page can say how many went, which is the difference between a button that worked and one
 * that appeared to.
 */
adminNotificationsRouter.post(
  '/clear',
  asyncRoute(async (req, res) => {
    const { ids } = idsSchema.parse(req.body)
    const cleared = await clearNotifications(req.admin!._id, ids)
    res.json({ ok: true, cleared, unreadCount: await unreadCount(req.admin!._id) })
  }),
)

adminNotificationsRouter.post(
  '/restore',
  asyncRoute(async (req, res) => {
    const { ids } = idsSchema.parse(req.body)
    const restored = await restoreNotifications(req.admin!._id, ids)
    res.json({ ok: true, restored, unreadCount: await unreadCount(req.admin!._id) })
  }),
)

/** Clear everything at once. Anything still waiting on a person is kept unless asked for. */
adminNotificationsRouter.post(
  '/clear-all',
  asyncRoute(async (req, res) => {
    const { includeActions } = z
      .object({ includeActions: z.boolean().default(false) })
      .parse(req.body ?? {})

    const cleared = await clearAllNotifications(req.admin!._id, { includeActions })
    res.json({ ok: true, cleared, unreadCount: await unreadCount(req.admin!._id) })
  }),
)

/** Everything waiting on a payment check, oldest first — the student who has waited longest. */
adminNotificationsRouter.get(
  '/awaiting-confirmation',
  asyncRoute(async (_req, res) => {
    const bookings = await BookingModel.find({ status: 'awaiting_confirmation' })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean()

    const [sessions, students, courses] = await Promise.all([
      SessionModel.find({ _id: { $in: bookings.map((b) => b.sessionId) } }).lean(),
      StudentModel.find({ _id: { $in: bookings.map((b) => b.studentId) } }).lean(),
      CourseTypeModel.find().lean(),
    ])

    const sessionById = new Map(sessions.map((s) => [String(s._id), s]))
    const studentById = new Map(students.map((s) => [String(s._id), s]))
    const courseById = new Map(courses.map((c) => [String(c._id), c]))

    res.json({
      bookings: bookings.flatMap((b) => {
        const session = sessionById.get(String(b.sessionId))
        const student = studentById.get(String(b.studentId))
        if (!session || !student) return []

        return [
          {
            id: String(b._id),
            waitingSince: b.createdAt,
            wooOrderId: b.wooOrderId,
            student: {
              id: String(student._id),
              reference: student.reference ?? '',
              name: student.name,
              email: student.email,
              phone: student.phone,
            },
            /*
             * Whether money has actually changed hands. Two different situations land in this
             * queue — a shop payment awaiting a check, and someone with no package asking to
             * join — and telling the studio to "check the payment" for the second sends them
             * looking for money that was never sent.
             */
            paid: Boolean(b.wooOrderId),
            session: {
              id: String(session._id),
              title: session.title,
              startAt: session.startAt,
              when: formatSessionDateTime(session.startAt),
              courseName: courseById.get(String(session.courseTypeId))?.name ?? '',
            },
          },
        ]
      }),
    })
  }),
)

/**
 * What has already been dealt with.
 *
 * The queue only ever showed what was outstanding, so the moment something was approved it
 * vanished with no record on screen — leaving no way to answer "did I already confirm Aiko?"
 * except by searching the student list one name at a time. Approving twice is harmless; not
 * knowing whether you did is not.
 */
adminNotificationsRouter.get(
  '/history',
  asyncRoute(async (req, res) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(req.query)

    /*
     * Anything that passed through this queue: confirmed after a check, or cancelled instead.
     * `confirmedAt` is only set by an approval, so it separates these from the ordinary bookings
     * that never needed one.
     */
    const bookings = await BookingModel.find({
      $or: [
        { status: 'confirmed', confirmedAt: { $ne: null } },
        { status: 'cancelled', cancelledAt: { $ne: null } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(limit ?? 40)
      .lean()

    const [sessions, students] = await Promise.all([
      SessionModel.find({ _id: { $in: bookings.map((b) => b.sessionId) } }).lean(),
      StudentModel.find({ _id: { $in: bookings.map((b) => b.studentId) } }).lean(),
    ])
    const sessionById = new Map(sessions.map((x) => [String(x._id), x]))
    const studentById = new Map(students.map((x) => [String(x._id), x]))

    res.json({
      bookings: bookings.flatMap((b) => {
        const session = sessionById.get(String(b.sessionId))
        const student = studentById.get(String(b.studentId))
        if (!session || !student) return []

        const declined = b.status === 'cancelled'

        return [
          {
            id: String(b._id),
            outcome: declined ? 'declined' : 'confirmed',
            at: declined ? b.cancelledAt : b.confirmedAt,
            by: declined ? b.cancelledBy : '',
            reason: declined ? b.cancelReason : '',
            wooOrderId: b.wooOrderId,
            student: {
              id: String(student._id),
              reference: student.reference ?? '',
              name: student.name,
              email: student.email,
            },
            session: {
              id: String(session._id),
              title: session.title,
              startAt: session.startAt,
              when: formatSessionDateTime(session.startAt),
            },
          },
        ]
      }),
    })
  }),
)

/** The payment checked out — give the student their place and send the confirmation. */
adminNotificationsRouter.post(
  '/bookings/:id/approve',
  asyncRoute(async (req, res) => {
    const result = await approveBooking(req.params.id!, actorOf(req))
    res.json({
      ok: true,
      booking: { id: String(result.booking._id), status: result.booking.status },
    })
  }),
)

/**
 * The payment never arrived, or it was not what the student claimed.
 *
 * This cancels rather than reverting to a hold: a hold expires on its own and would quietly
 * vanish, leaving nobody with a record of why the place went. A cancellation is visible, tells
 * the student, and hands the place back to the calendar.
 */
adminNotificationsRouter.post(
  '/bookings/:id/decline',
  asyncRoute(async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().max(300).default('') })
      .parse(req.body)

    const booking = await BookingModel.findById(req.params.id)
    if (!booking) throw new NotFoundError('Booking')
    if (booking.status !== 'awaiting_confirmation') {
      throw new AppError(409, 'not_awaiting', 'That booking is not waiting to be confirmed.')
    }

    await cancelBooking({
      bookingId: booking._id,
      reason: reason || 'We could not confirm the payment for this booking.',
      by: actorOf(req),
    })

    res.json({ ok: true })
  }),
)

/** Used by the console to decide whether to show the "needs attention" strip at all. */
adminNotificationsRouter.get(
  '/summary',
  asyncRoute(async (req, res) => {
    const [unseen, awaiting, holds] = await Promise.all([
      unreadCount(req.admin!._id),
      BookingModel.countDocuments({ status: 'awaiting_confirmation' }),
      BookingModel.countDocuments({
        status: { $in: ACTIVE_BOOKING_STATUSES },
        holdExpiresAt: { $lt: new Date() },
      }),
    ])

    res.json({ unreadCount: unseen, awaitingConfirmation: awaiting, strandedHolds: holds })
  }),
)
