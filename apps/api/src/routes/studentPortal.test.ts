import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { LoginTokenModel, SessionModel, StudentModel, type CourseTypeDoc } from '../models/index.js'
import { createBooking } from '../services/bookingService.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { generateMagicToken } from '../auth/tokens.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'

/**
 * The student's own page, and the contact number now required to book.
 *
 * Signing in goes through the real magic-link exchange rather than a forged cookie, so these
 * also cover the path a student actually takes from their inbox.
 */
const app = createApp()

let ikebana: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  ikebana = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid', wooProductIds: [42] })
})

/** Mint and redeem a real sign-in link, returning an agent carrying the session cookie. */
async function signIn(email: string) {
  const student = await StudentModel.findOne({ email })
  const { token, tokenHash } = generateMagicToken()
  await LoginTokenModel.create({
    studentId: student!._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  })

  const agent = request.agent(app)
  await agent.get(`/api/auth/magic-link/verify?token=${token}`).expect(302)
  return agent
}

describe('a phone number is required to book', () => {
  it('refuses a booking with no number', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: String(session._id), email: 'aiko@example.com', name: 'Aiko Tan' })
      .expect(400)

    expect(res.body.error.code).toBe('validation_error')
    expect(JSON.stringify(res.body.error.details)).toContain('phone')
  })

  it('refuses a number that is too short to be real', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    for (const phone of ['123', 'n/a', '-', '00']) {
      await request(app)
        .post('/api/bookings/start')
        .send({ sessionId: String(session._id), email: 'aiko@example.com', name: 'Aiko', phone })
        .expect(400)
    }
  })

  it('accepts the shapes real students type', async () => {
    // Deliberately permissive: rejecting a legitimate foreign number is a worse failure
    // than accepting an oddly punctuated one.
    for (const phone of ['+65 9123 4567', '91234567', '+44 (0)20 7946 0958', '+81-3-1234-5678']) {
      const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
      await request(app)
        .post('/api/bookings/start')
        .send({ sessionId: String(session._id), email: `s${phone.replace(/\D/g, '')}@example.com`, name: 'S', phone })
        .expect(200)
    }
  })

  it('stores the number against the student', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    await request(app)
      .post('/api/bookings/start')
      .send({ sessionId: String(session._id), email: 'aiko@example.com', name: 'Aiko Tan', phone: '+65 9123 4567' })
      .expect(200)

    const student = await StudentModel.findOne({ email: 'aiko@example.com' })
    expect(student!.phone).toBe('+65 9123 4567')
  })
})

describe('the student portal', () => {
  it('refuses everything until signed in', async () => {
    await request(app).get('/api/bookings/mine').expect(401)
    await request(app).get('/api/bookings/history').expect(401)
    await request(app).patch('/api/bookings/me').send({ name: 'X', phone: '+65 9123 4567', marketingOptIn: false }).expect(401)
  })

  it('shows a signed-in student their own bookings and package balance', async () => {
    const student = await makeStudent({ email: 'aiko@example.com', name: 'Aiko Tan' })
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    await createBooking({ sessionId: session._id, studentId: student._id, usePackage: false, notify: false })

    const agent = await signIn('aiko@example.com')
    const res = await agent.get('/api/bookings/mine').expect(200)

    expect(res.body.bookings).toHaveLength(1)
    expect(res.body.bookings[0].session.title).toBeTruthy()
    expect(res.body.bookings[0]).toHaveProperty('canReschedule')
    expect(res.body.bookings[0]).toHaveProperty('rescheduleDeadline')
  })

  it('lets a student correct their own name and number', async () => {
    await makeStudent({ email: 'aiko@example.com', name: 'Aiko Tan', phone: '+65 1111 1111' })
    const agent = await signIn('aiko@example.com')

    const res = await agent
      .patch('/api/bookings/me')
      .send({ name: 'Aiko Tanaka', phone: '+65 9000 1234', marketingOptIn: true })
      .expect(200)

    expect(res.body.student).toMatchObject({ name: 'Aiko Tanaka', phone: '+65 9000 1234' })

    const fresh = await StudentModel.findOne({ email: 'aiko@example.com' })
    expect(fresh!.marketingOptIn).toBe(true)
  })

  it('will not let a student change their own email', async () => {
    // It is their sign-in identity — changing it by form is how someone locks themselves out.
    await makeStudent({ email: 'aiko@example.com', name: 'Aiko Tan' })
    const agent = await signIn('aiko@example.com')

    await agent
      .patch('/api/bookings/me')
      .send({ name: 'Aiko', phone: '+65 9000 1234', marketingOptIn: false, email: 'someone-else@example.com' })
      .expect(200)

    expect(await StudentModel.findOne({ email: 'aiko@example.com' })).toBeTruthy()
    expect(await StudentModel.findOne({ email: 'someone-else@example.com' })).toBeNull()
  })

  it('rejects a bad number from the portal too', async () => {
    await makeStudent({ email: 'aiko@example.com', name: 'Aiko Tan' })
    const agent = await signIn('aiko@example.com')

    await agent.patch('/api/bookings/me').send({ name: 'Aiko', phone: '123', marketingOptIn: false }).expect(400)
  })

  it('returns past classes, most recent first, with attendance', async () => {
    const student = await makeStudent({ email: 'aiko@example.com', name: 'Aiko Tan' })

    // Two classes already behind them.
    const older = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-01' })
    const newer = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-05' })
    for (const s of [older, newer]) {
      await createBooking({ sessionId: s._id, studentId: student._id, usePackage: false, notify: false, now: new Date('2026-07-01') })
    }
    await SessionModel.updateOne({ _id: older._id }, { $set: {} })

    const agent = await signIn('aiko@example.com')
    const res = await agent.get('/api/bookings/history').expect(200)

    expect(res.body.classes).toHaveLength(2)
    expect(res.body.classes[0].startAt > res.body.classes[1].startAt).toBe(true)
    expect(res.body.totals.total).toBe(2)
  })

  it('gives a student a calendar invitation for their own booking, and nobody else’s', async () => {
    const mine = await makeStudent({ email: 'aiko@example.com', name: 'Aiko Tan' })
    const theirs = await makeStudent({ email: 'other@example.com', name: 'Someone Else' })
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    const a = await createBooking({ sessionId: session._id, studentId: mine._id, usePackage: false, notify: false })
    const b = await createBooking({ sessionId: session._id, studentId: theirs._id, usePackage: false, notify: false })

    const agent = await signIn('aiko@example.com')

    const ok = await agent.get(`/api/bookings/${a.booking._id}/calendar.ics`).expect(200)
    expect(ok.headers['content-type']).toContain('text/calendar')
    expect(ok.text).toContain('BEGIN:VEVENT')

    await agent.get(`/api/bookings/${b.booking._id}/calendar.ics`).expect(403)
  })
})
