import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { studioInstant } from '@mizuki/shared'
import { createApp } from '../app.js'
import { BookingModel, OutboxModel, SessionModel, StudentModel, type CourseTypeDoc } from '../models/index.js'
import { createBooking } from '../services/bookingService.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'
import { atSeedTime } from '../test/clock.js'

const app = createApp()
const SECRET = 'test-woo-webhook-secret'
const NOW = studioInstant('2026-08-11', '10:00')

let ikebana: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  ikebana = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid' })
})

/** Sign exactly as the WordPress plugin does: HMAC-SHA256 over the JSON body. */
function send(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload)
  return request(app)
    .post('/api/woo/order')
    .set('Content-Type', 'application/json')
    .set('X-Mizuki-Signature', crypto.createHmac('sha256', secret).update(body).digest('hex'))
    .send(body)
}

const orderFor = (sessionId: string, holdToken = '', overrides: Record<string, unknown> = {}) => ({
  event: 'paid',
  orderId: 5001,
  status: 'processing',
  customer: { email: 'aiko@example.com', name: 'Aiko Tan', phone: '+65 9123 4567', wooId: 0 },
  lines: [{ sessionId, holdToken, productId: 42, quantity: 1 }],
  timestamp: 1_760_000_000,
  ...overrides,
})

describe('signature checking', () => {
  it('refuses an unsigned callback', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id })
    await request(app).post('/api/woo/order').send(orderFor(String(session._id))).expect(403)
  })

  it('refuses a callback signed with the wrong secret', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id })
    await send(orderFor(String(session._id)), 'not-the-real-secret').expect(403)
  })

  it('refuses a body that was altered after signing', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id })
    const original = JSON.stringify(orderFor(String(session._id)))
    const signature = crypto.createHmac('sha256', SECRET).update(original).digest('hex')

    // Same signature, different order id — a tampered replay.
    await request(app)
      .post('/api/woo/order')
      .set('Content-Type', 'application/json')
      .set('X-Mizuki-Signature', signature)
      .send(JSON.stringify({ ...orderFor(String(session._id)), orderId: 9999 }))
      .expect(403)
  })
})

describe('payment confirms a held place', () => {
  it('turns the hold into a confirmed booking', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-22' })
    const student = await makeStudent({ email: 'aiko@example.com' })

    const { booking } = await createBooking({
      sessionId: session._id,
      studentId: student._id,
      status: 'hold',
      usePackage: false,
      holdToken: 'hold-abc',
      holdExpiresAt: new Date(Date.now() + 20 * 60_000),
      notify: false,
      now: NOW,
    })

    const res = await send(orderFor(String(session._id), 'hold-abc')).expect(200)
    expect(res.body.ok).toBe(true)

    const fresh = await BookingModel.findById(booking._id)
    expect(fresh!.status).toBe('confirmed')
    expect(fresh!.wooOrderId).toBe(5001)
    // The place was already counted while held — confirming must not count it twice.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('sends the confirmation email once payment lands', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-22' })
    const student = await makeStudent({ email: 'aiko@example.com' })
    await createBooking({
      sessionId: session._id,
      studentId: student._id,
      status: 'hold',
      usePackage: false,
      holdToken: 'hold-abc',
      notify: false,
      now: NOW,
    })

    await send(orderFor(String(session._id), 'hold-abc')).expect(200)

    expect(await OutboxModel.exists({ type: 'booking_confirmation', to: 'aiko@example.com' })).toBeTruthy()
  })

  it('is safe when WooCommerce sends the same callback twice', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-22' })
    const student = await makeStudent({ email: 'aiko@example.com' })
    await createBooking({
      sessionId: session._id,
      studentId: student._id,
      status: 'hold',
      usePackage: false,
      holdToken: 'hold-abc',
      notify: false,
      now: NOW,
    })

    await send(orderFor(String(session._id), 'hold-abc')).expect(200)
    await send(orderFor(String(session._id), 'hold-abc')).expect(200)

    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
    expect(await BookingModel.countDocuments({ sessionId: session._id, status: 'confirmed' })).toBe(1)
    expect(await OutboxModel.countDocuments({ type: 'booking_confirmation' })).toBe(1)
  })

  it('creates the student and seats them when there was no hold at all', async () => {
    // Someone bought the workshop straight from the shop, bypassing the calendar.
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-22' })

    const res = await atSeedTime(() => send(orderFor(String(session._id))).expect(200), '2026-08-11', '10:00')
    expect(res.body.ok).toBe(true)

    const student = await StudentModel.findOne({ email: 'aiko@example.com' })
    expect(student).toBeTruthy()
    expect(student!.name).toBe('Aiko Tan')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })
})

describe('payment arriving after the place is gone', () => {
  it('never overbooks, and raises an alert instead', async () => {
    // One place, and it went to someone else while this student was paying.
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-08-22' })
    const other = await makeStudent()
    await createBooking({
      sessionId: session._id,
      studentId: other._id,
      usePackage: false,
      notify: false,
      now: NOW,
    })

    const res = await atSeedTime(
      () => send(orderFor(String(session._id), 'expired-hold')).expect(200),
      '2026-08-11',
      '10:00',
    )

    expect(res.body.ok).toBe(false)
    expect(res.body.problems).toHaveLength(1)

    // The class must still hold exactly one student.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)

    const alert = await OutboxModel.findOne({ type: 'admin_paid_but_full' })
    expect(alert).toBeTruthy()
    expect(alert!.bodyText).toContain('PAID BUT NO PLACE')
    expect(alert!.bodyText).toContain('5001')
  })
})

describe('cancellations and refunds', () => {
  it('gives the place back when an order is cancelled', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-22' })
    const student = await makeStudent({ email: 'aiko@example.com' })
    await createBooking({
      sessionId: session._id,
      studentId: student._id,
      usePackage: false,
      wooOrderId: 5001,
      notify: false,
      now: NOW,
    })

    const res = await send(orderFor(String(session._id), '', { event: 'cancelled', status: 'cancelled' })).expect(200)

    expect(res.body.released).toBe(1)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })

  it('gives the place back on a refund', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-22' })
    const student = await makeStudent({ email: 'aiko@example.com' })
    await createBooking({
      sessionId: session._id,
      studentId: student._id,
      usePackage: false,
      wooOrderId: 5001,
      notify: false,
      now: NOW,
    })

    await send(orderFor(String(session._id), '', { event: 'refunded', status: 'refunded' })).expect(200)

    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })
})
