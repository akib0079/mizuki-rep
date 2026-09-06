import { beforeEach, describe, expect, it } from 'vitest'
import { studioInstant } from '@mizuki/shared'
import { sendDailyDigest } from './index.js'
import { AdminUserModel, OutboxModel, SettingModel } from '../models/index.js'
import { setExtraRecipients } from '../services/adminNotificationService.js'
import { queueAdminBroadcast } from '../services/notificationService.js'
import { makeCourseType, makeSession } from '../test/factories.js'
import { config } from '../config.js'

/**
 * Who the studio's own alerts reach.
 *
 * The daily digest went to `ADMIN_ALERT_EMAIL` and nowhere else, so on a deployment where that
 * variable was never set it returned at its second line every single morning: nothing sent,
 * nothing queued, nothing failed, and therefore nothing to notice — the studio found out by
 * realising they had never received one. There was no test at all, which is the deeper reason.
 *
 * These pin the two things that were wrong: alerts go to the people on the team page rather than
 * to one address from the environment, and they still go when that address does not exist.
 */

const admin = (email: string) =>
  AdminUserModel.create({
    name: email.split('@')[0]!,
    email,
    passwordHash: 'not-used-here',
    role: 'owner',
    active: true,
  })

/** Recipients of a queued email of this type, lowercased and sorted for comparison. */
async function sentTo(type: string): Promise<string[]> {
  const rows = await OutboxModel.find({ type, channel: 'email' }).lean()
  return rows.map((r) => r.to).sort()
}

/** 09:00 in Singapore, which is after the 07:00 digest hour. */
const morning = studioInstant('2026-09-08', '09:00')

/**
 * Run something as a deployment where `ADMIN_ALERT_EMAIL` was never set — the studio's own.
 *
 * The resolved config is patched rather than `process.env`, because the environment is read once
 * when the config module loads and never again: deleting the variable inside a test looks like it
 * proves something and changes nothing, so the test would pass against the very bug it names.
 */
async function withoutAlertEmail(run: () => Promise<void>): Promise<void> {
  const mutable = config as { ADMIN_ALERT_EMAIL?: string }
  const original = mutable.ADMIN_ALERT_EMAIL
  mutable.ADMIN_ALERT_EMAIL = undefined
  try {
    await run()
  } finally {
    mutable.ADMIN_ALERT_EMAIL = original
  }
}

describe('the daily digest', () => {
  beforeEach(async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-08', time: '10:00' })
  })

  it('goes to every active admin, not just the address in the environment', async () => {
    await admin('mizukisg148@gmail.com')
    await admin('hana@mizuki.com.sg')

    expect(await sendDailyDigest(morning)).toBe(true)

    expect(await sentTo('admin_daily_digest')).toEqual([
      'hana@mizuki.com.sg',
      'mizukisg148@gmail.com',
      // ADMIN_ALERT_EMAIL is still honoured, so an existing deployment keeps working.
      'studio@example.com',
    ])
  })

  it('still sends when ADMIN_ALERT_EMAIL was never set — the bug the studio reported', async () => {
    await admin('mizukisg148@gmail.com')

    await withoutAlertEmail(async () => {
      expect(await sendDailyDigest(morning)).toBe(true)
    })

    expect(await sentTo('admin_daily_digest')).toEqual(['mizukisg148@gmail.com'])
  })

  it('includes extra addresses that have no console login', async () => {
    await admin('mizukisg148@gmail.com')
    await setExtraRecipients(['bookings@mizuki.com.sg'])

    await sendDailyDigest(morning)

    expect(await sentTo('admin_daily_digest')).toContain('bookings@mizuki.com.sg')
  })

  it('sends once a day however often the tick runs', async () => {
    await admin('mizukisg148@gmail.com')

    await sendDailyDigest(morning)
    await sendDailyDigest(studioInstant('2026-09-08', '09:05'))
    await sendDailyDigest(studioInstant('2026-09-08', '11:30'))

    const rows = await OutboxModel.find({ type: 'admin_daily_digest', channel: 'email' }).lean()
    expect(rows.filter((r) => r.to === 'mizukisg148@gmail.com')).toHaveLength(1)
  })

  it('holds off until the studio is awake', async () => {
    await admin('mizukisg148@gmail.com')

    expect(await sendDailyDigest(studioInstant('2026-09-08', '05:00'))).toBe(false)
    expect(await OutboxModel.countDocuments({ type: 'admin_daily_digest' })).toBe(0)
  })

  it('sends on demand at any hour, and again even after today’s has gone', async () => {
    await admin('mizukisg148@gmail.com')

    await sendDailyDigest(morning)
    // What the settings page's button does. Blocking this would make the button look broken
    // for the rest of every day — which is exactly when someone presses it.
    expect(await sendDailyDigest(studioInstant('2026-09-08', '05:00'), { force: true })).toBe(true)

    const rows = await OutboxModel.find({
      type: 'admin_daily_digest',
      channel: 'email',
      to: 'mizukisg148@gmail.com',
    }).lean()
    expect(rows).toHaveLength(2)
  })

  it('leaves out an admin whose access was removed', async () => {
    await admin('mizukisg148@gmail.com')
    const gone = await admin('former@mizuki.com.sg')
    gone.active = false
    await gone.save()

    await sendDailyDigest(morning)

    expect(await sentTo('admin_daily_digest')).not.toContain('former@mizuki.com.sg')
  })
})

describe('every studio alert', () => {
  it('reaches the whole team, and each person only once', async () => {
    await admin('mizukisg148@gmail.com')
    await admin('hana@mizuki.com.sg')

    const queued = await queueAdminBroadcast('admin_new_booking', {
      dedupeSuffix: 'booking-1',
      subject: 'New booking',
      html: '<p>New booking</p>',
      text: 'New booking',
    })

    expect(queued).toBe(3)
    // A retried job must not send it again.
    expect(
      await queueAdminBroadcast('admin_new_booking', {
        dedupeSuffix: 'booking-1',
        subject: 'New booking',
        html: '<p>New booking</p>',
        text: 'New booking',
      }),
    ).toBe(0)
  })

  it('skips Telegram until a chat is chosen, not just a token pasted', async () => {
    await admin('mizukisg148@gmail.com')

    // Half-configured: the state Telegram makes easy to reach, and it delivers nothing.
    await SettingModel.create({ key: 'secret.telegramBotToken', value: 'unreadable-ciphertext' })

    await queueAdminBroadcast('admin_new_booking', {
      dedupeSuffix: 'booking-2',
      subject: 'New booking',
      html: '<p>New booking</p>',
      text: 'New booking',
      telegramText: 'New booking',
    })

    expect(await OutboxModel.countDocuments({ channel: 'telegram' })).toBe(0)
  })

  it('writes the row for a paid-but-full order even with nobody to send it to', async () => {
    await withoutAlertEmail(async () => {
      // No admins at all either. The most urgent message in the system must not be the one that
      // vanishes — an undelivered row is still visible in the console.
      await queueAdminBroadcast('admin_paid_but_full', {
        dedupeSuffix: 'order-99',
        subject: 'Action needed',
        html: '<p>Action needed</p>',
        text: 'Action needed',
        alwaysQueue: true,
      })
    })

    expect(await OutboxModel.countDocuments({ type: 'admin_paid_but_full' })).toBe(1)
  })
})
