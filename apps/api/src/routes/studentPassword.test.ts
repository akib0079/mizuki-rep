import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import argon2 from 'argon2'
import { createApp } from '../app.js'
import { COOKIE_NAMES, signStudentToken } from '../auth/tokens.js'
import { resetAuthRateLimits } from './auth.js'
import { StudentModel } from '../models/index.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'
import { createBooking } from '../services/bookingService.js'

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

async function withPassword(password: string, email = 'aiko@example.com', phone?: string) {
  /*
   * Phone set at creation, not afterwards. `phoneDigits` — the field the duplicate check
   * actually compares — is derived in a pre-save hook guarded on `isModified('phone')`, so
   * writing the same value again leaves it empty and the match silently never fires.
   */
  const student = await makeStudent({ email, ...(phone ? { phone } : {}) })
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
    const course = await makeCourseType({ bookingMode: 'paid', wooProductIds: [42] })
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

  it('still takes a booking without one, so a stale page cannot fail', async () => {
    /*
     * The form requires a password; the server does not. A visitor holding the page from before
     * a deploy is running the old bundle, which sends none — and refusing that would turn a
     * deploy into a window where booking simply breaks. The requirement belongs where the person
     * is, and tolerance belongs at the door.
     */
    const course = await makeCourseType({ bookingMode: 'paid', wooProductIds: [42] })
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

describe('a password cannot be used to reach somebody else', () => {
  it('booking with an address already on file never touches that account\'s password', async () => {
    const existing = await withPassword('coral-lantern-97', 'aiko@example.com')
    const course = await makeCourseType({ bookingMode: 'paid', wooProductIds: [42] })
    const session = await makeSession({ courseTypeId: course._id, date: '2027-04-10' })

    /*
     * The attack this rules out: booking under somebody else's address with a password of your
     * choosing, and signing in as them. An exact email match is certain, so the route asks the
     * visitor to sign in and creates nothing.
     */
    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Not Aiko',
        email: 'aiko@example.com',
        phone: '+65 9000 0000',
        password: 'chosen-by-a-stranger',
      })
      .expect(200)

    expect(res.body.outcome).toBe('sign_in_required')
    await login('aiko@example.com', 'chosen-by-a-stranger').expect(401)
    await login('aiko@example.com', 'coral-lantern-97').expect(200)

    // And no second account was made under that address.
    expect(await StudentModel.countDocuments({ email: 'aiko@example.com' })).toBe(1)
    expect(String(existing._id)).toBe(String((await StudentModel.findOne({ email: 'aiko@example.com' }))!._id))
  })

  it('does not touch it when the phone number is the one already on file either', async () => {
    const held = await withPassword('coral-lantern-97', 'aiko@example.com', '+65 9123 4567')
    expect(held.phoneDigits).toContain('91234567')

    const course = await makeCourseType({ bookingMode: 'paid', wooProductIds: [42] })
    const session = await makeSession({ courseTypeId: course._id, date: '2027-04-10' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Someone Else',
        email: 'different@example.com',
        phone: '+65 9123 4567',
        password: 'chosen-by-a-stranger',
      })
      .expect(200)

    expect(res.body.outcome).toBe('sign_in_required')
    await login('aiko@example.com', 'chosen-by-a-stranger').expect(401)
  })

  it('ignores a password sent by someone already signed in', async () => {
    const victim = await withPassword('coral-lantern-97', 'aiko@example.com')
    const other = await makeStudent({ email: 'other@example.com' })
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(other._id),
      email: other.email,
    })}`

    const course = await makeCourseType({ bookingMode: 'paid', wooProductIds: [42] })
    const session = await makeSession({ courseTypeId: course._id, date: '2027-04-10' })

    /*
     * Signed in, the form's identity fields are not read at all — including this one. Booking is
     * never a way to set a password, on your own account or anyone else's.
     */
    await request(app)
      .post('/api/bookings/start')
      .set('Cookie', cookie)
      .send({ sessionId: String(session._id), email: 'aiko@example.com', password: 'chosen-by-a-stranger' })
      .expect(200)

    await login('aiko@example.com', 'chosen-by-a-stranger').expect(401)
    await login('aiko@example.com', 'coral-lantern-97').expect(200)
    expect(await StudentModel.exists({ _id: other._id, passwordHash: { $ne: null } })).toBeNull()
    expect(String(victim._id)).toBeTruthy()
  })

  it('will not let a merged-away account sign in', async () => {
    const kept = await makeStudent({ email: 'kept@example.com' })
    const merged = await withPassword('coral-lantern-97', 'merged@example.com')
    merged.mergedInto = kept._id
    await merged.save()

    // Their bookings and credits now live on the other record; signing in here would show an
    // empty account and let them cancel nothing.
    await login('merged@example.com', 'coral-lantern-97').expect(401)
  })
})

describe('the session a password hands back', () => {
  it('actually opens their own bookings', async () => {
    const student = await withPassword('coral-lantern-97')
    const course = await makeCourseType({ bookingMode: 'paid', wooProductIds: [42] })
    const session = await makeSession({ courseTypeId: course._id, date: '2027-04-10' })
    await createBooking({
      sessionId: session._id,
      studentId: student._id,
      source: 'student_web',
      notify: false,
    })

    const res = await login('aiko@example.com', 'coral-lantern-97').expect(200)
    const cookie = res.headers['set-cookie']

    const mine = await request(app).get('/api/bookings/mine').set('Cookie', cookie).expect(200)
    expect(mine.body.bookings).toHaveLength(1)

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
    expect(me.body.student.email).toBe('aiko@example.com')
  })
})

describe('the details of getting it wrong', () => {
  it('accepts the address however it was typed', async () => {
    await withPassword('coral-lantern-97', 'aiko@example.com')
    // Stored lowercase; nobody types their own address consistently.
    await login('Aiko@Example.COM', 'coral-lantern-97').expect(200)
  })

  it('forgets the failures once they get it right', async () => {
    await withPassword('coral-lantern-97')

    for (let i = 0; i < 7; i++) await login('aiko@example.com', `guess-${i}`)
    await login('aiko@example.com', 'coral-lantern-97').expect(200)

    /*
     * Sixteen requests from one address is past the per-IP limit, which is a different guard
     * with a different job. Cleared here so what is left under test is the account's own count.
     */
    resetAuthRateLimits()

    // Without the reset, seven old failures plus one new one would lock a correct password out.
    for (let i = 0; i < 7; i++) await login('aiko@example.com', `guess-again-${i}`)
    await login('aiko@example.com', 'coral-lantern-97').expect(200)
  })

  it('lets them back in once the lockout has passed', async () => {
    const student = await withPassword('coral-lantern-97')

    for (let i = 0; i < 8; i++) await login('aiko@example.com', `guess-${i}`)
    await login('aiko@example.com', 'coral-lantern-97').expect(429)

    // A lockout that never lifts is an account nobody can recover without the studio.
    student.set('lockedUntil', new Date(Date.now() - 1000))
    await student.save()

    await login('aiko@example.com', 'coral-lantern-97').expect(200)
  })

  it('keeps a password exactly as typed, spaces and all', async () => {
    const student = await makeStudent({ email: 'aiko@example.com' })
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    // Trimming would silently change what they chose, and lock them out of their own account.
    await request(app)
      .post('/api/auth/student/password')
      .set('Cookie', cookie)
      .send({ password: '  spaced out  ' })
      .expect(200)

    await login('aiko@example.com', '  spaced out  ').expect(200)
    await login('aiko@example.com', 'spaced out').expect(401)
  })

  it('takes a password that is not written in English', async () => {
    const student = await makeStudent({ email: 'aiko@example.com' })
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    await request(app)
      .post('/api/auth/student/password')
      .set('Cookie', cookie)
      .send({ password: '生け花のレッスン' })
      .expect(200)

    await login('aiko@example.com', '生け花のレッスン').expect(200)
  })

  it('says so when there is no password set, rather than guessing', async () => {
    const student = await makeStudent({ email: 'aiko@example.com' })
    const cookie = `${COOKIE_NAMES.student}=${signStudentToken({
      sub: String(student._id),
      email: student.email,
    })}`

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
    expect(res.body.student.hasPassword).toBe(false)
  })
})
