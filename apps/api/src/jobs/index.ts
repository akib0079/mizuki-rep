import { DateTime } from 'luxon'
import { STUDIO_TZ, sessionsRemaining } from '@mizuki/shared'
import {
  BookingModel,
  CourseTypeModel,
  PackageModel,
  SessionModel,
  StudentModel,
  type CourseTypeDoc,
  type SessionDoc,
  type StudentDoc,
} from '../models/index.js'
import { releaseSeat, findSeatDrift } from '../services/seatService.js'
import { restoreSession } from '../services/packageService.js'
import { queueMessage, queueReminder } from '../services/notificationService.js'
import { renderTemplate } from '../services/emailTemplates.js'
import { materializeSessions } from '../services/scheduleService.js'
import { drainOutbox } from '../services/mailer.js'
import { hoursSinceLastBackup, pruneOutbox, runBackup } from '../services/backupService.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Scheduled work, driven by a single hPanel cron entry hitting `POST /jobs/tick`.
 *
 * Every job here must be safe to run again — cron fires every five minutes, ticks can overlap,
 * and a retry after a timeout is normal. Idempotency comes from the Outbox dedupe key and from
 * conditional updates, never from assuming a job runs exactly once.
 */

export interface TickResult {
  holdsExpired: number
  remindersQueued: number
  sessionsGenerated: number
  packagesExpired: number
  packageWarnings: number
  digestQueued: boolean
  driftDetected: number
  backedUp: boolean
  mail: { sent: number; failed: number; skipped: number }
}

export async function runTick(now: Date = new Date()): Promise<TickResult> {
  const [holdsExpired, remindersQueued, generated, packages, digestQueued, drift, backedUp] = await Promise.all([
    expireHolds(now),
    sendReminders(now),
    generateUpcomingSessions(now),
    sweepPackages(now),
    sendDailyDigest(now),
    detectDrift(now),
    backupNightly(now),
  ])

  // Drain last so anything queued above goes out on this same tick.
  const mail = await drainOutbox()

  return {
    holdsExpired,
    remindersQueued,
    sessionsGenerated: generated,
    packagesExpired: packages.expired,
    packageWarnings: packages.warned,
    digestQueued,
    driftDetected: drift,
    backedUp,
    mail,
  }
}

/**
 * Release places held for a WooCommerce checkout that never completed.
 *
 * "Places are held during checkout and released automatically if payment isn't completed."
 */
export async function expireHolds(now: Date = new Date()): Promise<number> {
  const expired = await BookingModel.find({
    status: 'hold',
    holdExpiresAt: { $ne: null, $lte: now },
  }).limit(200)

  let released = 0
  for (const booking of expired) {
    // Conditional flip, so a webhook confirming payment at this exact moment wins and
    // the student who just paid does not lose their place to the sweeper.
    const claimed = await BookingModel.findOneAndUpdate(
      { _id: booking._id, status: 'hold' },
      { $set: { status: 'cancelled', cancelledAt: now, cancelReason: 'Payment not completed', cancelledBy: 'system' } },
      { new: true },
    )
    if (!claimed) continue

    await releaseSeat(booking.sessionId)
    if (booking.packageId) {
      await restoreSession(booking.packageId, { bookingId: booking._id, by: 'system', note: 'Hold expired' })
    }
    released++
  }

  if (released > 0) logger.info({ released }, 'Expired unpaid holds')
  return released
}

/**
 * "A reminder 2 days before the class."
 *
 * Sent at a fixed studio-local hour rather than exactly 48 hours before, so nobody is woken at
 * 6am. Deduplicated on the booking id, so the five-minute tick cannot send it repeatedly.
 */
export async function sendReminders(now: Date = new Date()): Promise<number> {
  const studioNow = DateTime.fromJSDate(now).setZone(STUDIO_TZ)
  if (studioNow.hour < config.REMINDER_SEND_HOUR) return 0

  const targetDay = studioNow.plus({ days: 2 })
  const dateKey = targetDay.toFormat('yyyy-MM-dd')

  const sessions = await SessionModel.find({ dateKey, status: 'scheduled' }).lean()
  if (sessions.length === 0) return 0

  const sessionById = new Map(sessions.map((s) => [String(s._id), s]))
  const bookings = await BookingModel.find({
    sessionId: { $in: sessions.map((s) => s._id) },
    status: 'confirmed',
  })

  const [students, courses] = await Promise.all([
    StudentModel.find({ _id: { $in: bookings.map((b) => b.studentId) } }),
    CourseTypeModel.find({ _id: { $in: sessions.map((s) => s.courseTypeId) } }),
  ])
  const studentById = new Map(students.map((s) => [String(s._id), s]))
  const courseById = new Map(courses.map((c) => [String(c._id), c]))

  let queued = 0
  for (const booking of bookings) {
    const session = sessionById.get(String(booking.sessionId))
    const student = studentById.get(String(booking.studentId))
    if (!session || !student) continue
    const courseType = courseById.get(String(session.courseTypeId))
    if (!courseType) continue

    await queueReminder({
      booking,
      session: session as unknown as SessionDoc,
      courseType,
      student,
      pkg: null,
    })

    booking.reminderSentAt = now
    await booking.save()
    queued++
  }

  if (queued > 0) logger.info({ dateKey, queued }, 'Queued 2-day reminders')
  return queued
}

/** Keep the rolling calendar window filled as time moves forward. */
export async function generateUpcomingSessions(now: Date = new Date()): Promise<number> {
  const result = await materializeSessions({ now })
  return result.created
}

/** Close out expired packages and warn students before they lose sessions they paid for. */
export async function sweepPackages(now: Date = new Date()): Promise<{ expired: number; warned: number }> {
  const expiredResult = await PackageModel.updateMany(
    { status: 'active', expiresAt: { $ne: null, $lte: now } },
    { $set: { status: 'expired' } },
  )

  const warnAt = DateTime.fromJSDate(now).plus({ days: 14 }).toJSDate()
  const expiring = await PackageModel.find({
    status: 'active',
    expiryNotifiedAt: null,
    expiresAt: { $ne: null, $gt: now, $lte: warnAt },
  }).limit(50)

  let warned = 0
  for (const pkg of expiring) {
    const remaining = sessionsRemaining(pkg)
    if (remaining <= 0) continue

    const [student, course] = await Promise.all([
      StudentModel.findById(pkg.studentId),
      CourseTypeModel.findById(pkg.courseTypeId),
    ])
    if (!student || !course) continue

    const rendered = await renderTemplate('package_expiring', {
      studentName: student.name,
      courseName: course.name,
      sessionsRemaining: remaining,
      packageExpiryDate: DateTime.fromJSDate(pkg.expiresAt!).setZone(STUDIO_TZ).toFormat('ccc d LLL yyyy'),
      siteUrl: config.PUBLIC_SITE_URL,
      bookingUrl: `${config.PUBLIC_SITE_URL}/book`,
      studioPhone: '+65 8821 9386',
    })

    await queueMessage('package_expiring', {
      dedupeKey: `package_expiring:${pkg._id}`,
      to: student.email,
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
    })

    pkg.expiryNotifiedAt = now
    await pkg.save()
    warned++
  }

  return { expired: expiredResult.modifiedCount, warned }
}

/** "Today: 3 classes, 11 students" — one message each morning. */
export async function sendDailyDigest(now: Date = new Date()): Promise<boolean> {
  const studioNow = DateTime.fromJSDate(now).setZone(STUDIO_TZ)
  if (studioNow.hour < config.DIGEST_SEND_HOUR) return false
  if (!config.ADMIN_ALERT_EMAIL && !config.TELEGRAM_BOT_TOKEN) return false

  const dateKey = studioNow.toFormat('yyyy-MM-dd')
  const sessions = await SessionModel.find({ dateKey, status: 'scheduled' }).sort({ startAt: 1 }).lean()

  const counts = await BookingModel.aggregate<{ _id: unknown; n: number }>([
    { $match: { sessionId: { $in: sessions.map((s) => s._id) }, status: { $in: ['confirmed', 'attended'] } } },
    { $group: { _id: '$sessionId', n: { $sum: 1 } } },
  ])
  const bookedBySession = new Map(counts.map((c) => [String(c._id), c.n]))
  const studentCount = counts.reduce((sum, c) => sum + c.n, 0)

  const lines = sessions.map((s) => {
    const booked = bookedBySession.get(String(s._id)) ?? 0
    const time = DateTime.fromJSDate(s.startAt).setZone(STUDIO_TZ).toFormat('h:mm a')
    return { time, title: s.title, booked, capacity: s.capacity }
  })

  const listText = lines.length
    ? lines.map((l) => `• ${l.time} — ${l.title}: ${l.booked}/${l.capacity} booked`).join('\n')
    : 'No classes scheduled today.'
  const listHtml = lines.length
    ? `<ul>${lines.map((l) => `<li><strong>${l.time}</strong> — ${l.title}: ${l.booked}/${l.capacity} booked</li>`).join('')}</ul>`
    : '<p>No classes scheduled today.</p>'

  const rendered = await renderTemplate('admin_daily_digest', {
    todayDate: studioNow.toFormat('cccc d LLLL yyyy'),
    sessionCount: sessions.length,
    studentCount,
    sessionListHtml: listHtml,
    sessionListText: listText,
    adminCalendarUrl: `${config.PUBLIC_API_URL}/admin/calendar`,
    siteUrl: config.PUBLIC_SITE_URL,
  })

  let queued = false
  if (config.ADMIN_ALERT_EMAIL) {
    queued =
      (await queueMessage('admin_daily_digest', {
        dedupeKey: `admin_daily_digest:${dateKey}`,
        to: config.ADMIN_ALERT_EMAIL,
        subject: rendered.subject,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
      })) || queued
  }

  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    queued =
      (await queueMessage('admin_daily_digest', {
        dedupeKey: `admin_daily_digest:telegram:${dateKey}`,
        channel: 'telegram',
        bodyText: `☀️ Today, ${studioNow.toFormat('ccc d LLL')}\n\n${listText}`,
      })) || queued
  }

  return queued
}

/**
 * Compare the denormalised seat counters against the bookings that actually exist.
 *
 * Reports rather than repairs: an unexplained mismatch is a symptom, and silently correcting it
 * would hide whatever caused it. Repair is a deliberate action in the admin console.
 */
export async function detectDrift(now: Date = new Date()): Promise<number> {
  const studioNow = DateTime.fromJSDate(now).setZone(STUDIO_TZ)
  // Once a day is enough for a consistency check; every tick would be wasteful.
  if (studioNow.hour !== 3) return 0

  const drift = await findSeatDrift(now)
  if (drift.length === 0) return 0

  logger.error({ drift }, 'Seat counter drift detected')

  if (config.ADMIN_ALERT_EMAIL) {
    await queueMessage('admin_seat_drift', {
      dedupeKey: `admin_seat_drift:${studioNow.toFormat('yyyy-MM-dd')}`,
      to: config.ADMIN_ALERT_EMAIL,
      subject: `Booking system: ${drift.length} class(es) have mismatched place counts`,
      bodyText: drift
        .map((d) => `${d.dateKey} ${d.title}: counter says ${d.storedSeatsTaken}, bookings say ${d.actualSeatsTaken}`)
        .join('\n'),
      bodyHtml: `<p>These classes have place counts that do not match their bookings:</p><ul>${drift
        .map((d) => `<li>${d.dateKey} ${d.title}: counter ${d.storedSeatsTaken}, bookings ${d.actualSeatsTaken}</li>`)
        .join('')}</ul>`,
    })
  }

  return drift.length
}

export type { StudentDoc, CourseTypeDoc }

/**
 * Take a backup once a day, in the quiet hour.
 *
 * Guarded on how long it has been rather than on a "did I run today" flag, so a host that
 * restarts, or a cron that misses its window, still gets a backup rather than skipping a day
 * and nobody noticing until it matters.
 */
export async function backupNightly(now: Date = new Date()): Promise<boolean> {
  const studioNow = DateTime.fromJSDate(now).setZone(STUDIO_TZ)
  if (studioNow.hour !== config.BACKUP_HOUR) return false

  const age = await hoursSinceLastBackup(now)
  if (age !== null && age < 20) return false

  try {
    await runBackup(now)
    await pruneOutbox(now)
    return true
  } catch (err) {
    logger.error({ err }, 'Backup failed')

    if (config.ADMIN_ALERT_EMAIL) {
      await queueMessage('admin_backup_failed', {
        dedupeKey: `admin_backup_failed:${studioNow.toFormat('yyyy-MM-dd')}`,
        to: config.ADMIN_ALERT_EMAIL,
        subject: 'Mizuki booking: last night\'s backup did not run',
        bodyText: `The nightly backup failed:\n\n${err instanceof Error ? err.message : String(err)}\n\nBookings are unaffected, but there is no fresh copy of the data until this is fixed.`,
        bodyHtml: `<p>The nightly backup failed:</p><pre>${err instanceof Error ? err.message : String(err)}</pre><p>Bookings are unaffected, but there is no fresh copy of the data until this is fixed.</p>`,
      })
    }
    return false
  }
}
