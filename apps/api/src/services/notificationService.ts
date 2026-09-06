import { Types } from 'mongoose'
import {
  formatDuration,
  formatSessionDateTime,
  formatTimeRange,
  rescheduleDeadline,
  seatsLeft,
  sessionsRemaining,
  type EmailTemplateKey,
} from '@mizuki/shared'
import { OutboxModel, type BookingDoc, type CourseTypeDoc, type PackageDoc, type SessionDoc, type StudentDoc } from '../models/index.js'
import { renderTemplate, wrapEmailHtml } from './emailTemplates.js'
import { kickOutbox } from './mailer.js'
import {
  notificationRecipients,
  recordAdminNotification,
  telegramConfigured,
} from './adminNotificationService.js'
import { config, bookingPageUrl, myBookingsUrl } from '../config.js'
import { logger } from '../logger.js'
import { isDuplicateKeyError } from './transaction.js'

/**
 * Everything the system sends goes through here, and everything here goes into the Outbox first.
 *
 * Queueing rather than sending inline means a booking never fails because Resend had a bad
 * minute, and the unique `dedupeKey` means a retried job cannot send a student the same
 * reminder twice. The sender drains the queue on the cron tick.
 */

export interface QueueOptions {
  dedupeKey: string
  channel?: 'email' | 'telegram' | 'webpush'
  to?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string
  payload?: Record<string, unknown>
  relatedBookingId?: Types.ObjectId | null
  relatedSessionId?: Types.ObjectId | null
}

/**
 * Add a message to the queue. A duplicate key means this exact message is already queued or
 * sent, which is success, not failure — that is the whole point of the key.
 */
export async function queueMessage(type: string, opts: QueueOptions): Promise<boolean> {
  try {
    await OutboxModel.create({
      type,
      channel: opts.channel ?? 'email',
      dedupeKey: opts.dedupeKey,
      to: opts.to ?? '',
      subject: opts.subject ?? '',
      bodyHtml: opts.bodyHtml ?? '',
      bodyText: opts.bodyText ?? '',
      payload: opts.payload ?? {},
      relatedBookingId: opts.relatedBookingId ?? null,
      relatedSessionId: opts.relatedSessionId ?? null,
      status: 'pending',
    })

    /*
     * Try to send it now rather than at the next five-minute tick. Fire-and-forget: whether the
     * message goes out this second is not something the booking in front of it should depend on.
     */
    kickOutbox()
    return true
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      logger.debug({ type, dedupeKey: opts.dedupeKey }, 'Message already queued — skipping duplicate')
      return false
    }
    throw err
  }
}

/** The variables every student-facing template can use. */
export function sessionVars(session: SessionDoc, courseType: CourseTypeDoc) {
  const durationMins = Math.round((session.endAt.getTime() - session.startAt.getTime()) / 60_000)
  return {
    sessionTitle: session.title || courseType.name,
    courseName: courseType.name,
    sessionDate: formatSessionDateTime(session.startAt).split(',')[0] ?? '',
    sessionTimeRange: formatTimeRange(session.startAt, session.endAt),
    sessionDuration: formatDuration(durationMins),
    rescheduleDeadline: formatSessionDateTime(rescheduleDeadline(session.startAt, courseType.rescheduleCutoffHours)),
  }
}

function studentVars(student: StudentDoc) {
  return {
    studentName: student.name,
    studentEmail: student.email,
    studentPhone: student.phone || '—',
    siteUrl: config.PUBLIC_SITE_URL,
    studioPhone: '+65 8821 9386',
    bookingUrl: bookingPageUrl(),
    myBookingsUrl: myBookingsUrl(),
  }
}

/** "You have 6 of 8 sessions left" — omitted entirely for one-off paid workshops. */
function packageLine(pkg: PackageDoc | null, courseName: string): string {
  if (!pkg) return ''
  const left = sessionsRemaining(pkg)
  return `You have ${left} of ${pkg.totalSessions} ${courseName} sessions remaining in your course package.`
}

/**
 * The same fact told to the studio rather than to the student.
 *
 * The admin alerts reused the student-facing line, so the studio was emailed "You have 6 of 8
 * IFDA sessions remaining in your course package" about somebody else's balance.
 */
function studioPackageLine(pkg: PackageDoc | null, courseName: string): string {
  if (!pkg) return ''
  const left = sessionsRemaining(pkg)
  return `They have ${left} of ${pkg.totalSessions} ${courseName} sessions left in their course package.`
}

interface BookingContext {
  booking: BookingDoc
  session: SessionDoc
  courseType: CourseTypeDoc
  student: StudentDoc
  pkg?: PackageDoc | null
}

async function queueStudentEmail(
  key: EmailTemplateKey,
  ctx: BookingContext,
  extraVars: Record<string, string | number> = {},
  dedupeSuffix = '',
): Promise<void> {
  const vars = {
    ...studentVars(ctx.student),
    ...sessionVars(ctx.session, ctx.courseType),
    packageLine: packageLine(ctx.pkg ?? null, ctx.courseType.name),
    ...extraVars,
  }

  const rendered = await renderTemplate(key, vars)

  await queueMessage(key, {
    dedupeKey: `${key}:${ctx.booking._id}${dedupeSuffix}`,
    to: ctx.student.email,
    subject: rendered.subject,
    bodyHtml: rendered.html,
    bodyText: rendered.text,
    relatedBookingId: ctx.booking._id,
    relatedSessionId: ctx.session._id,
    payload: { attachIcs: key === 'booking_confirmation' || key === 'reschedule_confirmed' },
  })
}

export async function queueBookingConfirmation(ctx: BookingContext): Promise<void> {
  await queueStudentEmail('booking_confirmation', ctx)
}

/**
 * Sent the moment a paid place lands on a course the studio confirms by hand.
 *
 * Not a confirmation and careful not to read like one: the place is held, the payment is being
 * checked, and the real confirmation follows. Without this the student pays and hears nothing,
 * which they reasonably read as the payment having failed.
 */
export async function queueBookingPendingConfirmation(ctx: BookingContext): Promise<void> {
  await queueStudentEmail('booking_pending_confirmation', ctx)
}

/**
 * Sent when the place is held but nothing has been paid — a student who asked to join a course
 * they have no package for. Says the place is reserved and that payment is still to be arranged,
 * rather than implying money has already changed hands.
 */
export async function queueBookingPendingPayment(ctx: BookingContext): Promise<void> {
  await queueStudentEmail('booking_pending_payment', ctx)
}

/** The studio's copy: a place is paid for and waiting on their check. */
export async function queueAdminAwaitingConfirmation(ctx: BookingContext): Promise<void> {
  const vars = {
    ...studentVars(ctx.student),
    ...sessionVars(ctx.session, ctx.courseType),
    seatsLeft: seatsLeft(ctx.session),
    capacity: ctx.session.capacity,
    packageLine: studioPackageLine(ctx.pkg ?? null, ctx.courseType.name),
    wooOrderId: ctx.booking.wooOrderId ?? '',
    adminSessionUrl: `${config.PUBLIC_API_URL}/admin/calendar?session=${ctx.session._id}&booking=${ctx.booking._id}`,
  }

  /*
   * Two situations reach this queue and they need opposite words. With a shop order the money is
   * in and the job is to check it; without one nothing has been paid and the job is to ask for
   * it. Sending "has paid" to the studio about someone who has not sends them looking through
   * their bank for a payment that was never made.
   */
  const key = ctx.booking.wooOrderId ? 'admin_awaiting_confirmation' : 'admin_awaiting_payment'
  const rendered = await renderTemplate(key, vars)

  await queueAdminBroadcast(key, {
    dedupeSuffix: String(ctx.booking._id),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    telegramText:
      `\u{1F4B3} ${ctx.student.name} \u2014 ${vars.sessionTitle}\n${vars.sessionDate} \u00B7 ${vars.sessionTimeRange}\n` +
      (ctx.booking.wooOrderId ? 'Paid, waiting for you to confirm.' : 'Payment still to arrange.'),
    bookingId: ctx.booking._id,
    sessionId: ctx.session._id,
  })
}

export interface AdminBroadcast {
  /** Tells one alert of this kind from the next: a booking id, an order number, today's date. */
  dedupeSuffix: string
  subject: string
  html: string
  text: string
  /** The short form for a phone. Omit and this alert simply does not go to Telegram. */
  telegramText?: string
  bookingId?: unknown
  sessionId?: unknown
  /**
   * Write the queue row even when there is nobody to send it to.
   *
   * For the one alert that must never evaporate — a student who paid for a place that no longer
   * exists. An undelivered row is still visible in the console; a row that was never written is
   * not anywhere.
   */
  alwaysQueue?: boolean
}

/**
 * Fan one alert out to everyone who should hear about it, on every channel that is set up.
 *
 * Every studio-facing alert in the system goes through here, and that is the point. They used to
 * be written out one at a time at each call site, each deciding for itself who to tell — and
 * because the obvious thing to write is `config.ADMIN_ALERT_EMAIL`, most of them told exactly one
 * address from the environment. The console said "every admin above is emailed automatically",
 * and for all but one alert that was not true: an unset variable meant the daily digest went
 * nowhere at all, silently, with three admins on the team page.
 *
 * Two rules keep this honest. Who hears about something is decided in one place
 * (`notificationRecipients`), so adding an admin adds them to everything at once. And whether
 * Telegram is on is asked of the secret store, which is where the console saves it — the old
 * checks read the environment variable, so a bot configured through the console was reported as
 * "Ready" on the settings page while every alert skipped it.
 *
 * The dedupe key carries the address, or the first recipient's row claims the key and everyone
 * else is silently dropped as a duplicate.
 */
export async function queueAdminBroadcast(key: string, opts: AdminBroadcast): Promise<number> {
  const recipients = await notificationRecipients()
  let queued = 0

  for (const to of recipients) {
    const sent = await queueMessage(key, {
      dedupeKey: `${key}:email:${opts.dedupeSuffix}:${to}`,
      to,
      subject: opts.subject,
      bodyHtml: opts.html,
      bodyText: opts.text,
      relatedBookingId: opts.bookingId as never,
      relatedSessionId: opts.sessionId as never,
    })
    if (sent) queued++
  }

  if (recipients.length === 0 && opts.alwaysQueue) {
    const sent = await queueMessage(key, {
      dedupeKey: `${key}:email:${opts.dedupeSuffix}`,
      to: '',
      subject: opts.subject,
      bodyHtml: opts.html,
      bodyText: opts.text,
      relatedBookingId: opts.bookingId as never,
      relatedSessionId: opts.sessionId as never,
    })
    if (sent) queued++
  }

  if (opts.telegramText && (await telegramConfigured())) {
    const sent = await queueMessage(key, {
      dedupeKey: `${key}:telegram:${opts.dedupeSuffix}`,
      channel: 'telegram',
      bodyText: opts.telegramText,
      relatedBookingId: opts.bookingId as never,
      relatedSessionId: opts.sessionId as never,
    })
    if (sent) queued++
  }

  return queued
}

export async function queueRescheduleConfirmation(
  ctx: BookingContext,
  previous: { startAt: Date; endAt: Date },
): Promise<void> {
  await queueStudentEmail('reschedule_confirmed', ctx, {
    previousSessionDate: formatSessionDateTime(previous.startAt).split(',')[0] ?? '',
    previousSessionTimeRange: formatTimeRange(previous.startAt, previous.endAt),
  })
}

export async function queueBookingCancelled(ctx: BookingContext): Promise<void> {
  await queueStudentEmail('booking_cancelled', ctx)
}

export async function queueSessionCancelled(ctx: BookingContext, reason: string): Promise<void> {
  await queueStudentEmail('session_cancelled', ctx, {
    cancelReasonLine: reason ? `Reason: ${reason}` : '',
  })
}

export async function queueSessionMoved(
  ctx: BookingContext,
  previous: { startAt: Date; endAt: Date },
): Promise<void> {
  // Suffixed with the new start time so a class moved twice notifies twice, while a
  // retried job for the same move stays deduplicated.
  await queueStudentEmail(
    'session_moved',
    ctx,
    {
      previousSessionDate: formatSessionDateTime(previous.startAt).split(',')[0] ?? '',
      previousSessionTimeRange: formatTimeRange(previous.startAt, previous.endAt),
    },
    `:${ctx.session.startAt.getTime()}`,
  )
}

export async function queueReminder(ctx: BookingContext): Promise<void> {
  await queueStudentEmail('reminder_2day', ctx)
}

/**
 * "An automatic notification for me whenever someone signs up for a session."
 *
 * Fans out across every channel the studio has configured — email always, plus Telegram and
 * web push for an actual phone alert. Each channel gets its own dedupe key so one failing
 * does not suppress the others.
 */
export async function queueAdminNewBooking(ctx: BookingContext): Promise<void> {
  const left = seatsLeft(ctx.session)
  const vars = {
    ...studentVars(ctx.student),
    ...sessionVars(ctx.session, ctx.courseType),
    bookingSource:
      ctx.booking.source === 'admin_manual'
        ? 'added by the studio'
        : ctx.booking.source === 'woo_order'
          ? 'shop checkout'
          : 'website',
    seatsTaken: ctx.session.seatsTaken,
    seatsLeft: left,
    capacity: ctx.session.capacity,
    packageLine: studioPackageLine(ctx.pkg ?? null, ctx.courseType.name),
    adminSessionUrl: `${config.PUBLIC_API_URL}/admin/calendar?session=${ctx.session._id}`,
  }

  const rendered = await renderTemplate('admin_new_booking', vars)

  const shortLine = `📅 ${ctx.student.name} booked ${vars.sessionTitle}\n${vars.sessionDate} · ${vars.sessionTimeRange}\n${left} of ${ctx.session.capacity} places left`

  await queueAdminBroadcast('admin_new_booking', {
    dedupeSuffix: String(ctx.booking._id),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    telegramText: shortLine,
    bookingId: ctx.booking._id,
    sessionId: ctx.session._id,
  })

  // The console copy, so a booking is never something that only ever existed in an inbox.
  await recordAdminNotification({
    type: 'new_booking',
    title: `${ctx.student.name} booked ${vars.sessionTitle}`,
    body: `${vars.sessionDate} · ${vars.sessionTimeRange} — ${left} of ${ctx.session.capacity} places left`,
    url: `/calendar?session=${ctx.session._id}`,
    bookingId: ctx.booking._id,
    sessionId: ctx.session._id,
    studentId: ctx.student._id,
    dedupeKey: `new_booking:${ctx.booking._id}`,
  })

  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    await queueMessage('admin_new_booking', {
      dedupeKey: `admin_new_booking:webpush:${ctx.booking._id}`,
      channel: 'webpush',
      subject: `New booking — ${ctx.student.name}`,
      bodyText: `${vars.sessionTitle} · ${vars.sessionDate} ${vars.sessionTimeRange}`,
      payload: { url: vars.adminSessionUrl },
      relatedBookingId: ctx.booking._id,
    })
  }
}

/** Cancellations and reschedules matter to the studio too — same fan-out, lighter wording. */
export async function queueAdminBookingChange(
  ctx: BookingContext,
  kind: 'cancelled' | 'rescheduled',
): Promise<void> {
  const vars = sessionVars(ctx.session, ctx.courseType)
  const verb = kind === 'cancelled' ? 'cancelled' : 'moved to'
  const line = `⚠️ ${ctx.student.name} ${verb} ${vars.sessionTitle}\n${vars.sessionDate} · ${vars.sessionTimeRange}`

  await queueAdminBroadcast(`admin_booking_${kind}`, {
    dedupeSuffix: String(ctx.booking._id),
    subject: `Booking ${kind}: ${ctx.student.name} — ${vars.sessionTitle}, ${vars.sessionDate}`,
    html: wrapEmailHtml(`<p>${line.replace(/\n/g, '<br />')}</p>`, config.PUBLIC_SITE_URL),
    text: line,
    telegramText: line,
    bookingId: ctx.booking._id,
    sessionId: ctx.session._id,
  })
}

export async function queueMagicLink(student: StudentDoc, url: string, tokenId: string): Promise<void> {
  // Read from the same setting the link's actual lifetime comes from, so the email cannot go on
  // promising a number the code stopped honouring — which is how it came to say thirty minutes.
  const rendered = await renderTemplate('magic_link', {
    ...studentVars(student),
    magicLinkUrl: url,
    expiryHours: config.MAGIC_LINK_TTL_HOURS,
  })
  await queueMessage('magic_link', {
    // Keyed on the token, so every fresh request sends, but a retry of the same one does not.
    dedupeKey: `magic_link:${tokenId}`,
    to: student.email,
    subject: rendered.subject,
    bodyHtml: rendered.html,
    bodyText: rendered.text,
  })
}

/**
 * The reset link for a studio login.
 *
 * Deliberately not queued behind a dedupe key tied to the admin: someone asking twice because
 * the first email has not arrived should get a second one, and the previous link has already
 * been invalidated by the time this is called.
 */
export async function queueAdminPasswordReset(
  to: string,
  name: string,
  resetUrl: string,
  expiryHours: number,
): Promise<void> {
  const rendered = await renderTemplate('admin_password_reset', {
    studentName: name,
    resetUrl,
    expiryHours,
    siteUrl: config.PUBLIC_SITE_URL,
  })

  await queueMessage('admin_password_reset', {
    dedupeKey: `admin_password_reset:${to}:${Date.now()}`,
    to,
    subject: rendered.subject,
    bodyHtml: rendered.html,
    bodyText: rendered.text,
  })
}
