import type { Types } from 'mongoose'
import { AdminNotificationModel, AdminUserModel, SettingModel } from '../models/index.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Who hears about a booking, and how.
 *
 * Two things were wrong with the old arrangement. The recipient was a single environment
 * variable, so adding a second person to the studio meant a redeploy. And the only channel was
 * email, so a place waiting on a payment check existed nowhere except an inbox — the exact place
 * the studio told us things get missed.
 *
 * Every alert now lands in the console as well, and goes to every active admin.
 */

/** The extra addresses setting: people who should hear about bookings without a console login. */
const EXTRA_RECIPIENTS_KEY = 'notification_emails'

/**
 * Everyone who should receive booking email.
 *
 * Active admins are included by definition — someone who can approve a place is someone who
 * needs to know there is one waiting. ADMIN_ALERT_EMAIL is still honoured so an existing
 * deployment keeps working, but it is no longer the only way to be on the list.
 */
export async function notificationRecipients(): Promise<string[]> {
  const [admins, extra] = await Promise.all([
    AdminUserModel.find({ active: true }).select('email').lean(),
    SettingModel.findOne({ key: EXTRA_RECIPIENTS_KEY }).lean(),
  ])

  const extraList = Array.isArray(extra?.value) ? (extra.value as unknown[]) : []

  const all = [
    ...admins.map((a) => a.email),
    ...extraList.filter((v): v is string => typeof v === 'string'),
    config.ADMIN_ALERT_EMAIL,
  ]

  // Lowercased before de-duplicating, or the same person listed two ways gets two copies.
  return [...new Set(all.map((e) => e?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))]
}

export async function setExtraRecipients(emails: string[]): Promise<string[]> {
  const cleaned = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  await SettingModel.findOneAndUpdate(
    { key: EXTRA_RECIPIENTS_KEY },
    { $set: { value: cleaned } },
    { upsert: true },
  )
  return cleaned
}

export async function getExtraRecipients(): Promise<string[]> {
  const row = await SettingModel.findOne({ key: EXTRA_RECIPIENTS_KEY }).lean()
  return Array.isArray(row?.value) ? (row.value as string[]) : []
}

export interface NotifyInput {
  type:
    | 'new_booking'
    | 'awaiting_confirmation'
    | 'booking_cancelled'
    | 'booking_rescheduled'
    | 'paid_but_full'
    | 'session_over_capacity'
  title: string
  body?: string
  severity?: 'info' | 'action'
  url?: string
  bookingId?: Types.ObjectId | null
  sessionId?: Types.ObjectId | null
  studentId?: Types.ObjectId | null
  /** Same contract as Outbox: a retried webhook must not stack duplicates. */
  dedupeKey?: string
}

/** Record something in the console. Never throws — an alert failing must not fail the booking. */
export async function recordAdminNotification(input: NotifyInput): Promise<void> {
  try {
    if (input.dedupeKey) {
      const existing = await AdminNotificationModel.findOne({ dedupeKey: input.dedupeKey }).lean()
      if (existing) return
    }

    await AdminNotificationModel.create({
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      severity: input.severity ?? 'info',
      url: input.url ?? '',
      relatedBookingId: input.bookingId ?? null,
      relatedSessionId: input.sessionId ?? null,
      relatedStudentId: input.studentId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
  } catch (err) {
    /*
     * A duplicate key here means two requests raced on the same dedupeKey and the other one won,
     * which is the outcome we wanted anyway. Anything else is worth knowing about, but a booking
     * that succeeded must not be reported as failed because its notification could not be filed.
     */
    if ((err as { code?: number }).code !== 11000) {
      logger.error({ err, type: input.type }, 'Could not record an admin notification')
    }
  }
}

/** Unread count for one admin — what the bell shows. */
export async function unreadCount(adminId: Types.ObjectId | string): Promise<number> {
  return AdminNotificationModel.countDocuments({ readBy: { $ne: adminId } })
}

export async function listNotifications(
  adminId: Types.ObjectId | string,
  opts: { limit?: number; onlyUnread?: boolean } = {},
) {
  const filter = opts.onlyUnread ? { readBy: { $ne: adminId } } : {}

  const rows = await AdminNotificationModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(opts.limit ?? 30, 100))
    .lean()

  return rows.map((n) => ({
    id: String(n._id),
    type: n.type,
    title: n.title,
    body: n.body,
    severity: n.severity,
    url: n.url,
    bookingId: n.relatedBookingId ? String(n.relatedBookingId) : null,
    read: (n.readBy ?? []).some((id) => String(id) === String(adminId)),
    resolvedAt: n.resolvedAt,
    createdAt: n.createdAt,
  }))
}

export async function markRead(adminId: Types.ObjectId | string, ids: string[]): Promise<void> {
  await AdminNotificationModel.updateMany(
    { _id: { $in: ids } },
    { $addToSet: { readBy: adminId } },
  )
}

export async function markAllRead(adminId: Types.ObjectId | string): Promise<void> {
  await AdminNotificationModel.updateMany(
    { readBy: { $ne: adminId } },
    { $addToSet: { readBy: adminId } },
  )
}

/** Called when the thing the notification was asking for has actually been done. */
export async function resolveForBooking(
  bookingId: Types.ObjectId | string,
  by: string,
): Promise<void> {
  await AdminNotificationModel.updateMany(
    { relatedBookingId: bookingId, severity: 'action', resolvedAt: null },
    { $set: { resolvedAt: new Date(), resolvedBy: by } },
  )
}
