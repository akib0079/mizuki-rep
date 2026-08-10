import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import {
  BookingModel,
  CourseSeriesModel,
  OutboxModel,
  SessionModel,
  type CourseTypeDoc,
  type SessionDoc,
} from '../models/index.js'
import { bookSeries, getSeriesAvailability } from './seriesService.js'
import { createBooking } from './bookingService.js'
import { seedEmailTemplates } from './emailTemplates.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'

/**
 * The Autumn Ikebana Course: four mornings sold as one thing.
 *
 * The property that matters throughout is all-or-nothing. A student on three dates of a
 * four-date course has bought something that does not work.
 */
const app = createApp()
const SECRET = 'test-woo-webhook-secret'
const COURSE_PRODUCT = 77

let ikebana: CourseTypeDoc
let sessions: SessionDoc[]
let series: Awaited<ReturnType<typeof CourseSeriesModel.create>>

beforeEach(async () => {
  await seedEmailTemplates()
  ikebana = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid' })

  sessions = await Promise.all(
    ['2026-09-12', '2026-09-26', '2026-10-10', '2026-10-24'].map((date, i) =>
      makeSession({
        courseTypeId: ikebana._id,
        date,
        time: '10:00',
        durationMins: 150,
        capacity: 6,
        title: `Autumn Ikebana Course — Day ${i + 1}`,
      }),
    ),
  )

  series = await CourseSeriesModel.create({
    name: 'Autumn Ikebana Course',
    courseTypeId: ikebana._id,
    sessionIds: sessions.map((s) => s._id),
    wooProductId: COURSE_PRODUCT,
    active: true,
  })
})

function wooCallback(payload: unknown) {
  const body = JSON.stringify(payload)
  return request(app)
    .post('/api/woo/order')
    .set('Content-Type', 'application/json')
    .set('X-Mizuki-Signature', crypto.createHmac('sha256', SECRET).update(body).digest('hex'))
    .send(body)
}

const courseOrder = (overrides: Record<string, unknown> = {}) => ({
  event: 'paid',
  orderId: 9001,
  status: 'processing',
  customer: { email: 'aiko@example.com', name: 'Aiko Tan', phone: '', wooId: 0 },
  lines: [{ sessionId: '', holdToken: '', productId: COURSE_PRODUCT, quantity: 1 }],
  ...overrides,
})

describe('booking a whole course', () => {
  it('books every date from one purchase', async () => {
    const student = await makeStudent()

    const result = await bookSeries({ seriesId: series._id, studentId: student._id })

    expect(result.bookings).toHaveLength(4)
    for (const session of sessions) {
      expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
    }
  })

  it('books all four dates through a shop purchase', async () => {
    const res = await wooCallback(courseOrder()).expect(200)

    expect(res.body.confirmed).toHaveLength(4)
    for (const session of sessions) {
      expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
    }
  })

  it('sends one email listing every date, not four separate confirmations', async () => {
    await wooCallback(courseOrder()).expect(200)

    const emails = await OutboxModel.find({ type: 'series_confirmation' })
    expect(emails).toHaveLength(1)
    expect(emails[0]!.bodyText).toContain('12 Sep 2026')
    expect(emails[0]!.bodyText).toContain('24 Oct 2026')
    expect(emails[0]!.bodyText).not.toMatch(/\{\{/)
  })

  it('does not double-book when WooCommerce calls back twice', async () => {
    await wooCallback(courseOrder()).expect(200)
    await wooCallback(courseOrder({ status: 'completed' })).expect(200)

    for (const session of sessions) {
      expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
    }
    expect(await BookingModel.countDocuments({ status: 'confirmed' })).toBe(4)
  })
})

describe('when one date is unavailable', () => {
  it('books nothing at all if any date is full', async () => {
    // Fill the third morning only.
    const third = sessions[2]!
    for (let i = 0; i < third.capacity; i++) {
      const filler = await makeStudent()
      await createBooking({ sessionId: third._id, studentId: filler._id, usePackage: false, notify: false })
    }

    const student = await makeStudent()
    await expect(bookSeries({ seriesId: series._id, studentId: student._id })).rejects.toMatchObject({
      code: 'series_full',
    })

    // The crucial part: the other three dates must be untouched, not holding a stranded student.
    expect((await SessionModel.findById(sessions[0]!._id))!.seatsTaken).toBe(0)
    expect((await SessionModel.findById(sessions[1]!._id))!.seatsTaken).toBe(0)
    expect((await SessionModel.findById(sessions[3]!._id))!.seatsTaken).toBe(0)
    expect(await BookingModel.countDocuments({ studentId: student._id })).toBe(0)
  })

  it('leaves no orphaned bookings behind after a failed course booking', async () => {
    const last = sessions[3]!
    for (let i = 0; i < last.capacity; i++) {
      const filler = await makeStudent()
      await createBooking({ sessionId: last._id, studentId: filler._id, usePackage: false, notify: false })
    }

    const student = await makeStudent()
    await expect(bookSeries({ seriesId: series._id, studentId: student._id })).rejects.toThrow()

    // Fails on the very last date, so three places were claimed and must all have gone back.
    expect(await BookingModel.countDocuments({ studentId: student._id })).toBe(0)
  })

  it('refuses a student who already holds a place on one of the dates', async () => {
    const student = await makeStudent()
    await createBooking({ sessionId: sessions[1]!._id, studentId: student._id, usePackage: false, notify: false })

    await expect(bookSeries({ seriesId: series._id, studentId: student._id })).rejects.toMatchObject({
      code: 'already_booked',
    })
  })
})

describe('what students see', () => {
  it('reports the places left as the tightest date allows', async () => {
    // Two places on the second morning, six everywhere else — the course can take two.
    await SessionModel.updateOne({ _id: sessions[1]!._id }, { $set: { seatsTaken: 4 } })

    const availability = await getSeriesAvailability(series._id)

    expect(availability.bookable).toBe(true)
    expect(availability.placesLeft).toBe(2)
    expect(availability.sessions).toHaveLength(4)
  })

  it('explains which date is blocking when the course is unbookable', async () => {
    await SessionModel.updateOne({ _id: sessions[2]!._id }, { $set: { seatsTaken: 6 } })

    const availability = await getSeriesAvailability(series._id)

    expect(availability.bookable).toBe(false)
    expect(availability.placesLeft).toBe(0)
    expect(availability.reason).toContain('Day 3')
    expect(availability.reason).toContain('10 Oct 2026')
  })

  it('lists the course over the public API in date order', async () => {
    const res = await request(app).get('/api/public/series').expect(200)

    expect(res.body.series).toHaveLength(1)
    expect(res.body.series[0].name).toBe('Autumn Ikebana Course')
    expect(res.body.series[0].sessions.map((s: { startAt: string }) => s.startAt.slice(0, 10))).toEqual([
      '2026-09-12',
      '2026-09-26',
      '2026-10-10',
      '2026-10-24',
    ])
  })

  it('never exposes who else is on the course', async () => {
    const student = await makeStudent({ email: 'private@example.com' })
    await bookSeries({ seriesId: series._id, studentId: student._id })

    const res = await request(app).get('/api/public/series').expect(200)
    expect(JSON.stringify(res.body)).not.toContain('private@example.com')
  })
})

describe('seeded from the real timetable', () => {
  it('builds the course from the four Autumn mornings already on the calendar', async () => {
    // Uses the seeded titles rather than duplicating dates, so moving a class on the
    // calendar keeps the course pointing at the right session.
    const { runSeed } = await import('../scripts/seed.js')
    await CourseSeriesModel.deleteMany({})
    await SessionModel.deleteMany({})
    await runSeed()

    const seeded = await CourseSeriesModel.findOne({ name: 'Autumn Ikebana Course' })
    expect(seeded).toBeTruthy()
    expect(seeded!.sessionIds).toHaveLength(4)

    const dates = await SessionModel.find({ _id: { $in: seeded!.sessionIds } }).sort({ startAt: 1 })
    expect(dates.map((d) => d.dateKey)).toEqual(['2026-09-12', '2026-09-26', '2026-10-10', '2026-10-24'])
  })
})
