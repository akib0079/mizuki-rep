import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import argon2 from 'argon2'
import { createApp } from '../app.js'
import { COOKIE_NAMES, signStudentToken } from '../auth/tokens.js'
import { resetAuthRateLimits } from './auth.js'
import { StudentModel } from '../models/index.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'

/**
 * Signing in with a password.
 *
 * The sign-in link stays the default and the recovery path. This exists because a link is only
 * as reliable as the inbox it lands in, and a student whose email is not arriving cannot see
 * their own bookings — which is how it was reported.
 */

const app = createApp()

/*
 * Every request here comes from the same loopback address, so the lockout test below would
 * otherwise spend the shared per-IP budget and the tests after it would fail on 429 rather than
 * on anything they are checking.
 */
beforeEach(() => resetAuthRateLimits())

const login = (email: string, password: string) =>
  request(app).post('/api/auth/student/login').send({ email, password })

async function withPassword(password: string, email = 'aiko@example.com') {
  const student = await makeStudent({ email })
  student.set('passwordHash', await argon2.hash(password, { type: argon2.argon2id }))
  await student.save()
  return student
}

describe('signing in with a password', () => {
  it('lets a student in and hands back a session', async () => {
    await withPassword('coral-lantern-97')

    const res = await login('aiko@example.com', 'coral-lantern-97').expect(200)

    expect(res.body.student.email).toBe('aiko@example.com')
    expect(res.headers['set-cookie'].join()).toContain(COOKIE_NAMES.student)
  })

  it('refuses the wrong password', async () => {
    await withPassword('coral-lantern-97')
    await login('aiko@example.com', 'not-the-password').expect(401)
  })

  it('says the same thing for an unknown address as for a wrong password', async () => {
    await withPassword('coral-lantern-97')

    const wrong = await login('aiko@example.com', 'nope').expect(401)
    const unknown = await login('nobody@example.com', 'nope').expect(401)

    // Anything more specific turns this into a way to ask which students exist.
    expect(unknown.body.error.message).toBe(wrong.body.error.message)
  })

  it('says the same thing again for a student who never set one', async () => {
    await makeStudent({ email: 'linked@example.com' })

    const res = await login('linked@example.com', 'anything-at-all').expect(401)
    expect(res.body.error.message).toContain('do not match')
  })

  it('locks the account after repeated wrong attempts', async () => {
    await withPassword('coral-lantern-97')

    for (let i = 0; i < 8; i++) await login('aiko@example.com', `guess-${i}`)

    // Even the right password waits, or the lockout would be trivially side-stepped.
    const res = await login('aiko@example.com', 'coral-lantern-97')
    expect(res.status).toBe(429)
  })

  it('never stores or returns the password itself', async () => {
    await withPassword('coral-lantern-97')

    const res = await login('aiko@example.com', 'coral-lantern-97').expect(200)
    expect(JSON.stringify(res.body)).not.toContain('coral-lantern-97')

    // Not selected by an ordinary query, so it cannot leak into a response by accident.
    const plain = await StudentModel.findOne({ email: 'aiko@example.com' }).lean()
    expect(plain).not.toHaveProperty('passwordHash')
  })
})

describe('choosing a password', () => {
  it('can be set from a session, so a sign-in link is the way back in', async () => {
    const student = await makeStudent({ email: 'aiko@example.com' })
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    await request(app)
      .post('/api/auth/student/password')
      .set('Cookie', cookie)
      .send({ password: 'jasmine-window-42' })
      .expect(200)

    await login('aiko@example.com', 'jasmine-window-42').expect(200)
  })

  it('replaces an old password rather than adding a second one', async () => {
    const student = await withPassword('coral-lantern-97')
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    await request(app)
      .post('/api/auth/student/password')
      .set('Cookie', cookie)
      .send({ password: 'jasmine-window-42' })
      .expect(200)

    await login('aiko@example.com', 'coral-lantern-97').expect(401)
    await login('aiko@example.com', 'jasmine-window-42').expect(200)
  })

  it('refuses one too short to be worth having', async () => {
    const student = await makeStudent({ email: 'aiko@example.com' })
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    await request(app)
      .post('/api/auth/student/password')
      .set('Cookie', cookie)
      .send({ password: 'short' })
      .expect(400)
  })

  it('needs a session — it is not a way to set a password on somebody else', async () => {
    await makeStudent({ email: 'aiko@example.com' })
    await request(app).post('/api/auth/student/password').send({ password: 'jasmine-window-42' }).expect(401)
  })
})

describe('booking with a password', () => {
  it('sets one, and signs them in there and then', async () => {
    const course = await makeCourseType({ bookingMode: 'paid' })
    const session = await makeSession({ courseTypeId: course._id, date: '2027-04-10' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Aiko Tan',
        email: 'aiko@example.com',
        phone: '+65 9123 4567',
        password: 'coral-lantern-97',
      })
      .expect(200)

    expect(res.body.outcome).not.toBe('sign_in_required')
    // Booked and signed in, rather than being sent to find an email to see their own booking.
    expect(res.headers['set-cookie']?.join() ?? '').toContain(COOKIE_NAMES.student)

    await login('aiko@example.com', 'coral-lantern-97').expect(200)
  })

  it('is optional — booking without one still works', async () => {
    const course = await makeCourseType({ bookingMode: 'paid' })
    const session = await makeSession({ courseTypeId: course._id, date: '2027-04-10' })

    await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Wei Ling Tan',
        email: 'weiling@example.com',
        phone: '+65 9234 5678',
      })
      .expect(200)

    expect(await StudentModel.exists({ email: 'weiling@example.com' })).toBeTruthy()
  })

  it('tells the page whether there is a password to change', async () => {
    const student = await withPassword('coral-lantern-97')
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
    expect(res.body.student.hasPassword).toBe(true)
    expect(res.body.student).not.toHaveProperty('passwordHash')
  })
})
