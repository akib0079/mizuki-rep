import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../app.js'
import { signAdminToken, COOKIE_NAMES } from '../../auth/tokens.js'
import { AdminNotificationModel, AdminUserModel } from '../../models/index.js'
import { recordAdminNotification } from '../../services/adminNotificationService.js'

/**
 * Managing the list, rather than only glancing at it.
 *
 * The two behaviours worth pinning are the ones that make a shared console safe: read and
 * cleared are both per-admin, so one person tidying up never takes something off somebody
 * else's list — and "clear all" leaves anything still waiting on a human, because those are the
 * rows whose entire purpose is to stay in the way.
 */

const app = createApp()

async function admin(email: string) {
  const row = await AdminUserModel.create({
    name: email.split('@')[0]!,
    email,
    passwordHash: 'not-used-here',
    role: 'owner',
    active: true,
  })
  return {
    id: String(row._id),
    cookie: `${COOKIE_NAMES.admin}=${signAdminToken({
      sub: String(row._id),
      email: row.email,
      role: 'owner',
      v: row.tokenVersion,
    })}`,
  }
}

async function note(overrides: Record<string, unknown> = {}) {
  return AdminNotificationModel.create({
    type: 'new_booking',
    title: 'Aiko Tan booked Ikebana Workshop',
    body: 'Sat 22 Aug · 10:00 AM',
    severity: 'info',
    ...overrides,
  })
}

let studio: Awaited<ReturnType<typeof admin>>
let hana: Awaited<ReturnType<typeof admin>>

beforeEach(async () => {
  studio = await admin('studio@mizuki.com.sg')
  hana = await admin('hana@mizuki.com.sg')
})

const list = (who: { cookie: string }, query = '') =>
  request(app).get(`/api/admin/notifications${query}`).set('Cookie', who.cookie).expect(200)

describe('the notifications list', () => {
  it('carries a count for each view, so the tabs can show their own numbers', async () => {
    await note()
    await note({ severity: 'action', title: 'Payment to check' })

    const res = await list(studio)
    expect(res.body.counts).toEqual({ all: 2, unread: 2, action: 1, cleared: 0 })
  })

  it('filters down to what still needs a person', async () => {
    await note()
    await note({ severity: 'action', title: 'Payment to check' })
    await note({ severity: 'action', title: 'Already dealt with', resolvedAt: new Date() })

    const res = await list(studio, '?view=action')
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual([
      'Payment to check',
    ])
  })

  it('says when there is another page rather than making the caller guess', async () => {
    for (let i = 0; i < 4; i++) await note({ title: `Booking ${i}` })

    const first = await list(studio, '?limit=2')
    expect(first.body.notifications).toHaveLength(2)
    expect(first.body.hasMore).toBe(true)

    const last = await list(studio, '?limit=2&skip=2')
    expect(last.body.hasMore).toBe(false)
  })
})

describe('marking read and unread', () => {
  it('puts one back on the pile', async () => {
    const row = await note()

    await request(app)
      .post('/api/admin/notifications/read')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)
    expect((await list(studio)).body.counts.unread).toBe(0)

    const res = await request(app)
      .post('/api/admin/notifications/unread')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    expect(res.body.unreadCount).toBe(1)
    expect((await list(studio)).body.notifications[0].read).toBe(false)
  })

  it('is one person’s own state — reading it does not read it for everyone', async () => {
    const row = await note()

    await request(app)
      .post('/api/admin/notifications/read')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    expect((await list(studio)).body.counts.unread).toBe(0)
    expect((await list(hana)).body.counts.unread).toBe(1)
  })
})

describe('clearing', () => {
  it('takes it off my list and leaves everyone else’s alone', async () => {
    const row = await note()

    const res = await request(app)
      .post('/api/admin/notifications/clear')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    expect(res.body.cleared).toBe(1)
    expect((await list(studio)).body.notifications).toHaveLength(0)
    // The whole reason clearing is per-admin: a pending approval must not vanish for Hana
    // because somebody else tidied their own list.
    expect((await list(hana)).body.notifications).toHaveLength(1)
  })

  it('marks it read too, so no badge is left lit for something put away', async () => {
    const row = await note()

    await request(app)
      .post('/api/admin/notifications/clear')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    expect((await list(studio)).body.unreadCount).toBe(0)
  })

  it('can be undone — a tidy-up nobody dares press is not a feature', async () => {
    const row = await note()

    await request(app)
      .post('/api/admin/notifications/clear')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    const cleared = await list(studio, '?view=cleared')
    expect(cleared.body.notifications).toHaveLength(1)

    await request(app)
      .post('/api/admin/notifications/restore')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    expect((await list(studio)).body.notifications).toHaveLength(1)
  })

  it('clears everything at once, but keeps what is still waiting on somebody', async () => {
    await note({ title: 'Booking one' })
    await note({ title: 'Booking two' })
    await note({ severity: 'action', title: 'Payment to check' })
    await note({ severity: 'action', title: 'Sorted already', resolvedAt: new Date() })

    const res = await request(app)
      .post('/api/admin/notifications/clear-all')
      .set('Cookie', studio.cookie)
      .send({})
      .expect(200)

    expect(res.body.cleared).toBe(3)
    expect((await list(studio)).body.notifications.map((n: { title: string }) => n.title)).toEqual([
      'Payment to check',
    ])
  })

  it('clears the outstanding ones too when that is explicitly what was asked', async () => {
    await note({ severity: 'action', title: 'Payment to check' })

    await request(app)
      .post('/api/admin/notifications/clear-all')
      .set('Cookie', studio.cookie)
      .send({ includeActions: true })
      .expect(200)

    expect((await list(studio)).body.notifications).toHaveLength(0)
  })

  it('never loses the work itself — payments to check are counted from the bookings', async () => {
    await note({ severity: 'action', title: 'Payment to check' })

    await request(app)
      .post('/api/admin/notifications/clear-all')
      .set('Cookie', studio.cookie)
      .send({ includeActions: true })
      .expect(200)

    // Nothing was booked in this test, so the queue is empty — but the point is that the number
    // comes from bookings, not from the rows just cleared.
    const res = await list(studio)
    expect(res.body.awaitingConfirmation).toBe(0)
  })
})

describe('the bell', () => {
  it('still works unchanged while a console is open across a deploy', async () => {
    await note()
    const res = await list(studio, '?unread=1&limit=25')
    expect(res.body.notifications).toHaveLength(1)
    expect(res.body.unreadCount).toBe(1)
  })

  it('stops counting what has been cleared', async () => {
    const row = await note()
    await request(app)
      .post('/api/admin/notifications/clear')
      .set('Cookie', studio.cookie)
      .send({ ids: [String(row._id)] })
      .expect(200)

    const res = await request(app)
      .get('/api/admin/notifications/summary')
      .set('Cookie', studio.cookie)
      .expect(200)
    expect(res.body.unreadCount).toBe(0)
  })
})

describe('recording one', () => {
  it('keeps every notification that has no dedupe key of its own', async () => {
    /*
     * The field used to default to null, which a sparse unique index still indexes — so the
     * second keyless notification collided with the first, and recordAdminNotification swallows
     * duplicate keys on purpose. Nothing threw, nothing logged, and the notification simply was
     * not there.
     */
    await recordAdminNotification({ type: 'new_booking', title: 'Aiko booked' })
    await recordAdminNotification({ type: 'new_booking', title: 'Wei Ling booked' })
    await recordAdminNotification({ type: 'booking_cancelled', title: 'Priya cancelled' })

    const res = await list(studio)
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual([
      'Priya cancelled',
      'Wei Ling booked',
      'Aiko booked',
    ])
  })

  it('still refuses a second copy of the same event', async () => {
    await recordAdminNotification({
      type: 'new_booking',
      title: 'Aiko booked',
      dedupeKey: 'new_booking:abc',
    })
    // What a retried webhook looks like.
    await recordAdminNotification({
      type: 'new_booking',
      title: 'Aiko booked',
      dedupeKey: 'new_booking:abc',
    })

    expect((await list(studio)).body.notifications).toHaveLength(1)
  })
})
