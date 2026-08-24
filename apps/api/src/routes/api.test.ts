import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { studioInstant } from '@mizuki/shared'
import { createApp } from '../app.js'
import { runSeed } from '../scripts/seed.js'
import {
  AdminNotificationModel,
  BookingModel,
  ClosedDateModel,
  CourseTypeModel,
  OutboxModel,
  SessionModel,
} from '../models/index.js'
import { makeStudent, makePackage } from '../test/factories.js'
import { atSeedTime } from '../test/clock.js'
import { expireHolds, sendReminders } from '../jobs/index.js'
import { createBooking } from '../services/bookingService.js'

const app = createApp()

/** The seeded calendar is fixed in 2026; queries are pinned to that window. */
const WINDOW = { from: '2026-08-11', to: '2026-11-30' }

beforeEach(async () => {
  await runSeed()
})

describe('public calendar', () => {
  it('returns every day in the window, including empty ones', async () => {
    const res = await request(app).get('/api/public/calendar').query(WINDOW).expect(200)

    expect(res.body.days.length).toBeGreaterThan(80)
    // Every day present, so the widget can draw a full month grid without inventing gaps.
    expect(res.body.days.every((d: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true)
  })

  it('shows the time, length and places left for each class', async () => {
    const res = await atSeedTime(() => request(app).get('/api/public/calendar').query(WINDOW).expect(200))

    const aug22 = res.body.days.find((d: { date: string }) => d.date === '2026-08-22')
    expect(aug22.sessions).toHaveLength(2)
    expect(aug22.sessions[0]).toMatchObject({
      courseName: 'Ikebana',
      durationMins: 150,
      isFull: false,
    })
    expect(aug22.sessions[0].seatsLeft).toBeGreaterThan(0)
  })

  it('never exposes who is booked', async () => {
    const res = await request(app).get('/api/public/calendar').query(WINDOW).expect(200)
    const body = JSON.stringify(res.body)

    expect(body).not.toMatch(/studentId/i)
    expect(body).not.toMatch(/roster/i)
    expect(body).not.toMatch(/@/)
  })

  it('marks a class full once every place is taken', async () => {
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })
    await SessionModel.updateOne({ _id: session!._id }, { $set: { seatsTaken: session!.capacity } })

    const res = await atSeedTime(() => request(app).get('/api/public/calendar').query(WINDOW).expect(200))
    const day = res.body.days.find((d: { date: string }) => d.date === '2026-08-22')

    expect(day.sessions[0]).toMatchObject({ isFull: true, seatsLeft: 0 })
  })

  it('hides a day the moment it is marked closed', async () => {
    const before = await atSeedTime(() => request(app).get('/api/public/calendar').query(WINDOW).expect(200))
    expect(before.body.days.find((d: { date: string }) => d.date === '2026-08-22').sessions).toHaveLength(2)

    await ClosedDateModel.create({ startDate: '2026-08-22', endDate: '2026-08-23', reason: 'Away' })

    const after = await atSeedTime(() => request(app).get('/api/public/calendar').query(WINDOW).expect(200))
    const day = after.body.days.find((d: { date: string }) => d.date === '2026-08-22')

    expect(day.isClosed).toBe(true)
    expect(day.sessions).toHaveLength(0)
  })

  it('offers alternative dates for the same course', async () => {
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })

    const res = await request(app).get(`/api/public/sessions/${session!._id}/alternatives`).expect(200)

    expect(res.body.alternatives.length).toBeGreaterThan(0)
    expect(res.body.alternatives.every((a: { courseName: string }) => a.courseName === 'Ikebana')).toBe(true)
    expect(res.body.alternatives.every((a: { id: string }) => a.id !== String(session!._id))).toBe(true)
  })

  it('lists the courses with their notice periods', async () => {
    const res = await request(app).get('/api/public/courses').expect(200)
    const bySlug = Object.fromEntries(res.body.courses.map((c: { slug: string }) => [c.slug, c]))

    expect(bySlug['ikebana'].rescheduleCutoffHours).toBe(72)
    expect(bySlug['ifda'].rescheduleCutoffHours).toBe(24)
  })
})

describe('booking endpoint', () => {
  it('routes a paid Ikebana workshop to the shop', async () => {
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })

    const res = await atSeedTime(() =>
      request(app)
        .post('/api/bookings/start')
        .send({ sessionId: String(session!._id), email: 'aiko@example.com', name: 'Aiko Tan', phone: '+65 9123 4567' })
        .expect(200),
    )

    expect(res.body.outcome).toBe('checkout_required')
  })

  it('refuses to spend an IFDA course session for someone who has not proved the inbox', async () => {
    const ifda = await CourseTypeModel.findOne({ slug: 'ifda' })
    const session = await SessionModel.findOne({ courseTypeId: ifda!._id, dateKey: '2026-09-05' })
    const student = await makeStudent({ email: 'mei@example.com', name: 'Mei' })
    await makePackage(student._id, ifda!._id, { totalSessions: 8 })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: String(session!._id), email: 'mei@example.com', name: 'Mei', phone: '+65 9123 4567' })
      .expect(200)

    /*
     * Knowing an address must not be enough to burn someone's paid-for sessions. This used to be
     * a package-only check; it is now the same rule for every course, so a known address always
     * has to prove the inbox before anything is booked against it.
     */
    expect(res.body.outcome).toBe('sign_in_required')
    expect(res.body.reason).toBe('email_known')
    expect(await BookingModel.countDocuments({ sessionId: session!._id })).toBe(0)

    /*
     * And no email goes out on its own. The student asks for the link from the next screen, so
     * typing a stranger's address into the booking form cannot be used to send them mail.
     */
    expect(await OutboxModel.exists({ type: 'magic_link', to: 'mei@example.com' })).toBeFalsy()
  })

  /*
   * This used to assert a 422 refusal, which is what the endpoint did: someone ready to pay was
   * turned away by a sentence telling them to "get in touch", with no booking, no place held,
   * and nobody at the studio told they had tried. Holding the place and raising it is the point.
   */
  it('holds a place for an IFDA booking with no course package, rather than refusing it', async () => {
    const ifda = await CourseTypeModel.findOne({ slug: 'ifda' })
    const session = await SessionModel.findOne({ courseTypeId: ifda!._id, dateKey: '2026-09-05' })
    const before = session!.seatsTaken

    const res = await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: String(session!._id), email: 'nobody@example.com', name: 'Nobody', phone: '+65 9123 4567' })
      .expect(201)

    expect(res.body.outcome).toBe('awaiting_confirmation')

    const booking = await BookingModel.findOne({ sessionId: session!._id }).sort({ createdAt: -1 })
    expect(booking!.status).toBe('awaiting_confirmation')
    // No package existed, so nothing may have been spent from one.
    expect(booking!.packageId).toBeNull()

    // The place is genuinely taken, not merely recorded.
    const after = await SessionModel.findById(session!._id)
    expect(after!.seatsTaken).toBe(before + 1)

    // And the studio has something to act on, rather than only the student knowing.
    const alert = await AdminNotificationModel.findOne({ relatedBookingId: booking!._id })
    expect(alert?.severity).toBe('action')
  })

  it('tells the student their place is held, without calling it confirmed', async () => {
    const ifda = await CourseTypeModel.findOne({ slug: 'ifda' })
    const session = await SessionModel.findOne({ courseTypeId: ifda!._id, dateKey: '2026-09-06' })

    await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: String(session!._id), email: 'waiting@example.com', name: 'Waiting', phone: '+65 9123 4567' })
      .expect(201)

    const booking = await BookingModel.findOne({ sessionId: session!._id }).sort({ createdAt: -1 })
    const mail = await OutboxModel.find({ relatedBookingId: booking!._id }).lean()
    const types = mail.map((m) => m.type)

    /*
     * Nobody has paid here — this student has no package and asked to join. So they get the
     * "place reserved, payment to arrange" wording, not the "we are checking your payment" one,
     * which would have them waiting for a confirmation nobody is going to send.
     */
    expect(types).toContain('booking_pending_payment')
    expect(types).not.toContain('booking_pending_confirmation')
    expect(types).not.toContain('booking_confirmation')

    // And the studio is asked to arrange payment rather than told the student has paid.
    expect(types).toContain('admin_awaiting_payment')
    expect(types).not.toContain('admin_awaiting_confirmation')
  })

  it('rejects a malformed request with field-level detail', async () => {
    const res = await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: 'not-an-id', email: 'not-an-email', name: '', phone: '+65 9123 4567' })
      .expect(400)

    expect(res.body.error.code).toBe('validation_error')
    expect(res.body.error.details.length).toBeGreaterThan(0)
  })

  it('requires sign-in to see or change someone else’s bookings', async () => {
    await request(app).get('/api/bookings/mine').expect(401)
    await request(app).post('/api/bookings/cancel').send({ bookingId: '000000000000000000000001' }).expect(401)
  })
})

describe('admin routes', () => {
  it('refuses every admin endpoint without a session', async () => {
    await request(app).get('/api/admin/sessions').query(WINDOW).expect(401)
    await request(app).get('/api/admin/students').expect(401)
    await request(app).post('/api/admin/closed-dates').send({ startDate: '2026-09-01', endDate: '2026-09-02' }).expect(401)
    await request(app).get('/api/admin/settings/templates').expect(401)
  })
})

describe('cron endpoint', () => {
  it('refuses without the shared secret', async () => {
    await request(app).post('/api/jobs/tick').expect(403)
    await request(app).post('/api/jobs/tick').set('X-Cron-Secret', 'wrong').expect(403)
  })

  it('runs when the secret matches', async () => {
    const res = await request(app)
      .post('/api/jobs/tick')
      .set('X-Cron-Secret', 'test-cron-secret-value')
      .expect(200)

    expect(res.body.ok).toBe(true)
    expect(res.body).toHaveProperty('holdsExpired')
    expect(res.body).toHaveProperty('remindersQueued')
  })
})

describe('scheduled jobs', () => {
  it('releases a place when checkout is abandoned', async () => {
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })
    const student = await makeStudent()

    await createBooking({
      sessionId: session!._id,
      studentId: student._id,
      status: 'hold',
      usePackage: false,
      holdExpiresAt: new Date(Date.now() - 60_000),
      now: studioInstant('2026-08-11', '10:00'),
    })
    expect((await SessionModel.findById(session!._id))!.seatsTaken).toBe(1)

    const released = await expireHolds(new Date())

    expect(released).toBe(1)
    expect((await SessionModel.findById(session!._id))!.seatsTaken).toBe(0)
  })

  it('leaves a hold alone until it actually expires', async () => {
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })
    const student = await makeStudent()

    await createBooking({
      sessionId: session!._id,
      studentId: student._id,
      status: 'hold',
      usePackage: false,
      holdExpiresAt: new Date(Date.now() + 20 * 60_000),
      now: studioInstant('2026-08-11', '10:00'),
    })

    expect(await expireHolds(new Date())).toBe(0)
    expect((await SessionModel.findById(session!._id))!.seatsTaken).toBe(1)
  })

  it('sends the 2-day reminder exactly once, however often cron fires', async () => {
    // Class on 22 Aug; "now" is the 20th, past the morning send hour.
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })
    const student = await makeStudent({ email: 'aiko@example.com' })

    await createBooking({
      sessionId: session!._id,
      studentId: student._id,
      usePackage: false,
      now: studioInstant('2026-08-11', '10:00'),
    })

    const reminderTime = studioInstant('2026-08-20', '09:30')
    expect(await sendReminders(reminderTime)).toBeGreaterThan(0)

    const firstCount = await OutboxModel.countDocuments({ type: 'reminder_2day' })
    expect(firstCount).toBeGreaterThan(0)

    // Cron fires every five minutes — the second pass must not queue another copy.
    await sendReminders(reminderTime)
    await sendReminders(reminderTime)

    expect(await OutboxModel.countDocuments({ type: 'reminder_2day' })).toBe(firstCount)
  })

  it('does not send reminders before the morning send hour', async () => {
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 })
    const student = await makeStudent()
    await createBooking({
      sessionId: session!._id,
      studentId: student._id,
      usePackage: false,
      now: studioInstant('2026-08-11', '10:00'),
    })

    // 6am — nobody should be woken by a class reminder.
    expect(await sendReminders(studioInstant('2026-08-20', '06:00'))).toBe(0)
  })
})

describe('health', () => {
  it('reports the database connection', async () => {
    const res = await request(app).get('/health').expect(200)
    expect(res.body).toMatchObject({ ok: true, db: 'connected' })
  })
})
