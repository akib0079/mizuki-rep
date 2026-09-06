import type { Types } from 'mongoose'
import { AdminNotificationModel, AdminUserModel, SettingModel } from '../models/index.js'
import { SECRET_KEYS, getSecret } from './secretStore.js'
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

/**
 * Is the Telegram bot actually reachable — a token *and* a chat to send to?
 *
 * Asked of the secret store rather than the environment, because the settings page writes there.
 * Every alert used to test `config.TELEGRAM_BOT_TOKEN` directly, so a bot the studio set up
 * through the console was reported as "Ready" on that page and then skipped by every single
 * alert: the check and the sender were reading two different places.
 *
 * A token with no chosen chat is the half-configured state Telegram makes easy to reach, and it
 * sends nothing — so both halves are required here, exactly as the sender requires them.
 */
export async function telegramConfigured(): Promise<boolean> {
  const [token, chatId] = await Promise.all([
    getSecret(SECRET_KEYS.telegramBotToken, config.TELEGRAM_BOT_TOKEN),
    getSecret(SECRET_KEYS.telegramChatId, config.TELEGRAM_CHAT_ID),
  ])
  return Boolean(token && chatId)
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
      // Left off entirely when there is none, so the unique index has nothing to collide on.
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
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

/** Unread count for one admin — what the bell shows. Cleared items no longer count. */
export async function unreadCount(adminId: Types.ObjectId | string): Promise<number> {
  return AdminNotificationModel.countDocuments({
    readBy: { $ne: adminId },
    clearedBy: { $ne: adminId },
  })
}

/** What the notifications page can be filtered down to. */
export type NotificationView = 'all' | 'unread' | 'action' | 'cleared'

/**
 * One admin's view of the list.
 *
 * `mine` is the base filter every view starts from: anything this person has cleared is off
 * their list, whatever anyone else has done with it. Only the `cleared` view looks at the other
 * side of that, so a clear is always undoable — a tidy-up that cannot be reversed is one people
 * are right to be nervous about, and hesitating over it is how a list stops being useful.
 */
export async function listNotifications(
  adminId: Types.ObjectId | string,
  opts: { limit?: number; skip?: number; view?: NotificationView; type?: string } = {},
) {
  const mine = { clearedBy: { $ne: adminId } }

  const view: Record<NotificationView, Record<string, unknown>> = {
    all: mine,
    unread: { ...mine, readBy: { $ne: adminId } },
    // Something still waiting on a person, rather than something that merely happened.
    action: { ...mine, severity: 'action', resolvedAt: null },
    cleared: { clearedBy: adminId },
  }

  const filter = {
    ...view[opts.view ?? 'all'],
    ...(opts.type ? { type: opts.type } : {}),
  }

  const limit = Math.min(opts.limit ?? 30, 100)
  const skip = Math.max(opts.skip ?? 0, 0)

  // One extra row, purely to answer "is there more?" without a second count query.
  const rows = await AdminNotificationModel.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit + 1)
    .lean()

  const hasMore = rows.length > limit

  return {
    items: rows.slice(0, limit).map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      body: n.body,
      severity: n.severity,
      url: n.url,
      bookingId: n.relatedBookingId ? String(n.relatedBookingId) : null,
      studentId: n.relatedStudentId ? String(n.relatedStudentId) : null,
      read: (n.readBy ?? []).some((id) => String(id) === String(adminId)),
      cleared: (n.clearedBy ?? []).some((id) => String(id) === String(adminId)),
      resolvedAt: n.resolvedAt,
      createdAt: n.createdAt,
    })),
    hasMore,
  }
}

/** How many are in each view, so the tabs can carry their own numbers. */
export async function notificationCounts(adminId: Types.ObjectId | string) {
  const mine = { clearedBy: { $ne: adminId } }

  const [all, unread, action, cleared] = await Promise.all([
    AdminNotificationModel.countDocuments(mine),
    AdminNotificationModel.countDocuments({ ...mine, readBy: { $ne: adminId } }),
    AdminNotificationModel.countDocuments({ ...mine, severity: 'action', resolvedAt: null }),
    AdminNotificationModel.countDocuments({ clearedBy: adminId }),
  ])

  return { all, unread, action, cleared }
}

export async function markRead(adminId: Types.ObjectId | string, ids: string[]): Promise<void> {
  await AdminNotificationModel.updateMany(
    { _id: { $in: ids } },
    { $addToSet: { readBy: adminId } },
  )
}

/**
 * Put something back on the pile.
 *
 * The console's only way of saying "not yet, come back to this" — otherwise a glance at a
 * notification is indistinguishable from having dealt with it, and the list quietly empties
 * itself of things nobody has actually done.
 */
export async function markUnread(adminId: Types.ObjectId | string, ids: string[]): Promise<void> {
  await AdminNotificationModel.updateMany({ _id: { $in: ids } }, { $pull: { readBy: adminId } })
}

export async function markAllRead(adminId: Types.ObjectId | string): Promise<void> {
  await AdminNotificationModel.updateMany(
    { readBy: { $ne: adminId }, clearedBy: { $ne: adminId } },
    { $addToSet: { readBy: adminId } },
  )
}

/**
 * Take these off this admin's list.
 *
 * Clearing also marks read: an item put away is one that has been dealt with, and leaving it
 * counted as unread would keep a badge lit for something the person has explicitly finished with.
 */
export async function clearNotifications(
  adminId: Types.ObjectId | string,
  ids: string[],
): Promise<number> {
  const result = await AdminNotificationModel.updateMany(
    { _id: { $in: ids } },
    { $addToSet: { clearedBy: adminId, readBy: adminId } },
  )
  return result.modifiedCount
}

/** Put cleared items back on the list. */
export async function restoreNotifications(
  adminId: Types.ObjectId | string,
  ids: string[],
): Promise<number> {
  const result = await AdminNotificationModel.updateMany(
    { _id: { $in: ids } },
    { $pull: { clearedBy: adminId } },
  )
  return result.modifiedCount
}

/**
 * Clear the lot.
 *
 * Anything still waiting on a person is left alone unless asked for explicitly. "Clear all"
 * after a busy morning should tidy away what has happened, not the two places somebody has paid
 * for and is waiting on — and those are the rows whose whole purpose is to stay in the way.
 */
export async function clearAllNotifications(
  adminId: Types.ObjectId | string,
  opts: { includeActions?: boolean } = {},
): Promise<number> {
  const result = await AdminNotificationModel.updateMany(
    {
      clearedBy: { $ne: adminId },
      ...(opts.includeActions ? {} : { $or: [{ severity: { $ne: 'action' } }, { resolvedAt: { $ne: null } }] }),
    },
    { $addToSet: { clearedBy: adminId, readBy: adminId } },
  )
  return result.modifiedCount
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
