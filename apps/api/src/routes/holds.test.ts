import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { BookingModel, CourseTypeModel, OutboxModel, SessionModel } from '../models/index.js'
import { expireHolds } from '../jobs/index.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { makeCourseType, makeSession } from '../test/factories.js'

/**
 * "Places are held during checkout and released automatically if payment isn't completed."
 *
 * These follow one place through every way that can end: paid, abandoned, timed out, and the
 * awkward one where the student pays after their hold already lapsed.
 */
const app = createApp()
const SECRET = 'test-woo-webhook-secret'

let ikebana: Awaited<ReturnType<typeof makeCourseType>>

beforeEach(async () => {
  await seedEmailTemplates()
  ikebana = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid', wooProductIds: [42] })
})

function startBooking(sessionId: string, email = 'aiko@example.com') {
  /*
   * A phone derived from the address, so two different students are two different people. Sharing
   * one number made them look like the same person booking twice, which the duplicate-account
   * guard now stops before capacity is ever reached — masking the very thing these tests check.
   */
  const digits = String(Math.abs([...email].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 90000000 + 10000000)

  // The name has to differ too, for the same reason the number does: two students who share
  // both look like one person booking twice, which is now caught before capacity is reached.
  const who = email.split('@')[0] ?? 'student'

  return request(app)
    .post('/api/bookings/start')
    .send({ sessionId, email, name: `Aiko ${who}`, phone: `+65 ${digits}` })
}

function wooCallback(payload: unknown) {
  const body = JSON.stringify(payload)
  return request(app)
    .post('/api/woo/order')
    .set('Content-Type', 'application/json')
    .set('X-Mizuki-Signature', crypto.createHmac('sha256', SECRET).update(body).digest('hex'))
    .send(body)
}

describe('taking a place before checkout', () => {
  it('reserves the place and hands back a checkout link carrying the hold', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    const res = await startBooking(String(session._id)).expect(200)

    expect(res.body.outcome).toBe('checkout_required')
    expect(res.body.holdToken).toHaveLength(32)
    expect(res.body.checkoutUrl).toContain('add-to-cart=42')
    expect(res.body.checkoutUrl).toContain(`mizuki_session=${session._id}`)
    expect(res.body.checkoutUrl).toContain(`mizuki_hold=${res.body.holdToken}`)

    // The place is genuinely taken — this is the whole point.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
    expect(new Date(res.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('stops the last place being sold twice while someone is paying', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-10-17' })

    await startBooking(String(session._id), 'first@example.com').expect(200)

    // Second student arrives while the first is still in checkout.
    const second = await startBooking(String(session._id), 'second@example.com').expect(409)
    expect(second.body.error.code).toBe('session_full')
  })

  it('shows the class as full to everyone else while the place is held', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-10-17' })
    await startBooking(String(session._id)).expect(200)

    const cal = await request(app)
      .get('/api/public/calendar')
      .query({ from: '2026-10-17', to: '2026-10-17' })
      .expect(200)

    const day = cal.body.days.find((d: { date: string }) => d.date === '2026-10-17')
    expect(day.sessions[0]).toMatchObject({ isFull: true, seatsLeft: 0 })
  })

  it('does not email anyone about a place that is only held', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    await startBooking(String(session._id)).expect(200)

    // Nothing is confirmed yet: telling the student would be a lie, and telling the studio
    // would mean an alert for every abandoned cart.
    expect(await OutboxModel.countDocuments({ type: 'booking_confirmation' })).toBe(0)
    expect(await OutboxModel.countDocuments({ type: 'admin_new_booking' })).toBe(0)
  })
})

describe('how a hold ends', () => {
  it('becomes a confirmed place when payment arrives', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    const started = await startBooking(String(session._id)).expect(200)

    await wooCallback({
      event: 'paid',
      orderId: 7001,
      status: 'processing',
      customer: { email: 'aiko@example.com', name: 'Aiko Tan', phone: '', wooId: 0 },
      lines: [{ sessionId: String(session._id), holdToken: started.body.holdToken, productId: 42, quantity: 1 }],
    }).expect(200)

    const booking = await BookingModel.findById(started.body.bookingId)
    expect(booking!.status).toBe('confirmed')
    expect(booking!.wooOrderId).toBe(7001)

    // Held then confirmed is still one place, not two.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
    expect(await OutboxModel.exists({ type: 'booking_confirmation' })).toBeTruthy()
    expect(await OutboxModel.exists({ type: 'admin_new_booking' })).toBeTruthy()
  })

  it('returns the place the moment the student says they will book later', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-10-17' })
    const started = await startBooking(String(session._id), 'first@example.com').expect(200)

    await request(app).post('/api/bookings/release-hold').send({ holdToken: started.body.holdToken }).expect(200)

    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
    // The next student can have it straight away, without waiting for the sweeper.
    await startBooking(String(session._id), 'second@example.com').expect(200)
  })

  it('treats releasing an unknown or already-released hold as success', async () => {
    // The student may double-click, or close the box after paying. Neither is an error.
    await request(app).post('/api/bookings/release-hold').send({ holdToken: 'nonexistent-token-value' }).expect(200)
  })

  it('releases the place automatically when checkout is abandoned', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    const started = await startBooking(String(session._id)).expect(200)

    // Wind the clock past the hold window.
    await BookingModel.updateOne(
      { _id: started.body.bookingId },
      { $set: { holdExpiresAt: new Date(Date.now() - 60_000) } },
    )

    expect(await expireHolds(new Date())).toBe(1)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
    expect((await BookingModel.findById(started.body.bookingId))!.status).toBe('cancelled')
  })

  it('lets payment win a race against the sweeper', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    const started = await startBooking(String(session._id)).expect(200)

    // Expired on paper, but the money arrives first.
    await BookingModel.updateOne(
      { _id: started.body.bookingId },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    )

    await wooCallback({
      event: 'paid',
      orderId: 7002,
      status: 'processing',
      customer: { email: 'aiko@example.com', name: 'Aiko Tan', phone: '', wooId: 0 },
      lines: [{ sessionId: String(session._id), holdToken: started.body.holdToken, productId: 42, quantity: 1 }],
    }).expect(200)

    // The sweeper must not then cancel a place that has been paid for.
    await expireHolds(new Date())

    const booking = await BookingModel.findById(started.body.bookingId)
    expect(booking!.status).toBe('confirmed')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('does not release a hold that is still within its window', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    await startBooking(String(session._id)).expect(200)

    expect(await expireHolds(new Date())).toBe(0)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })
})

describe('a course with no shop product yet', () => {
  it('still holds the place and sends the student to the shop', async () => {
    // The studio has not linked a Woo product to this course yet — the place must still be
    // protected, otherwise the gap between setup steps is a window for overselling.
    await CourseTypeModel.updateOne({ _id: ikebana._id }, { $set: { wooProductIds: [] } })
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 2, date: '2026-10-17' })

    const res = await startBooking(String(session._id)).expect(200)

    expect(res.body.checkoutUrl).toContain('/shop')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })
})
