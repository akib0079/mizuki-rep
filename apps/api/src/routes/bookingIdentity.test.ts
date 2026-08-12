import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { signStudentToken, COOKIE_NAMES } from '../auth/tokens.js'
import { BookingModel, CourseTypeModel, SessionModel, StudentModel } from '../models/index.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'

/**
 * Who a booking belongs to.
 *
 * The old rule was "whatever email the form sent", which meant anyone who knew a student's
 * address could book against their account and spend their course credits, and the same person
 * could arrive on the register under a different name every time. These tests are the rules that
 * replaced it.
 */

const app = createApp()

let session: Awaited<ReturnType<typeof makeSession>>

function asStudent(id: string) {
  return `${COOKIE_NAMES.student}=${signStudentToken({ sub: id, email: 'ignored@example.com' })}`
}

beforeEach(async () => {
  await seedEmailTemplates()
  const course = await makeCourseType({ name: 'Ikebana', slug: 'ike-identity', bookingMode: 'free' })
  session = await makeSession({ courseTypeId: course._id, capacity: 6, date: '2026-09-19' })
})

describe('booking as a visitor', () => {
  it('creates the account and books when the email is new', async () => {
    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'New Person',
        email: 'new@example.com',
        phone: '+65 9111 2222',
      })
      .expect(201)

    expect(res.body.outcome).toBe('booked')
    expect(await StudentModel.countDocuments({ email: 'new@example.com' })).toBe(1)
  })

  it('refuses to book onto an email that already has an account', async () => {
    await makeStudent({ name: 'Ayesha', email: 'ayesha@example.com', phone: '+65 9333 4444' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        // Somebody else's address, and a name that is not theirs.
        name: 'Not Ayesha',
        email: 'ayesha@example.com',
        phone: '+65 9555 6666',
      })
      .expect(200)

    expect(res.body.outcome).toBe('sign_in_required')
    expect(res.body.reason).toBe('email_known')

    // Nothing was taken: no booking, and the account's own name is untouched.
    expect(await BookingModel.countDocuments({ sessionId: session._id })).toBe(0)
    expect((await StudentModel.findOne({ email: 'ayesha@example.com' }))!.name).toBe('Ayesha')
  })

  it('points a returning student at the account their phone already belongs to', async () => {
    await makeStudent({ name: 'Ayesha', email: 'ayesha@example.com', phone: '+65 9333 4444' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Ayesha',
        // A second address — a typo, or a work account.
        email: 'ayesha.work@example.com',
        phone: '65 9333 4444',
      })
      .expect(200)

    expect(res.body.outcome).toBe('sign_in_required')
    expect(res.body.reason).toBe('phone_known')

    // Masked: this endpoint needs no session, so it must not tell a stranger which address
    // belongs to a phone number.
    expect(res.body.email).not.toContain('ayesha@example.com')
    expect(res.body.email).toContain('@example.com')

    expect(await BookingModel.countDocuments({ sessionId: session._id })).toBe(0)
  })

  it('matches a phone whether or not the country code was typed', async () => {
    await makeStudent({ name: 'Ayesha', email: 'ayesha@example.com', phone: '+65 9333 4444' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Someone',
        email: 'other@example.com',
        phone: '93334444',
      })
      .expect(200)

    expect(res.body.outcome).toBe('sign_in_required')
  })

  it('lets two genuinely different people book', async () => {
    await makeStudent({ name: 'One', email: 'one@example.com', phone: '+65 9000 0001' })

    await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Two',
        email: 'two@example.com',
        phone: '+65 9000 0002',
      })
      .expect(201)

    expect(await StudentModel.countDocuments()).toBe(2)
  })
})

describe('booking while signed in', () => {
  it('books against the account and ignores whatever the form claims', async () => {
    const student = await makeStudent({ name: 'Real Name', email: 'real@example.com', phone: '+65 9777 8888' })

    await request(app)
      .post('/api/bookings/start')
      .set('Cookie', asStudent(String(student._id)))
      .send({
        sessionId: String(session._id),
        // A hostile or careless client sending a different identity. It must not take.
        name: 'Someone Else',
        email: 'attacker@example.com',
        phone: '+65 0000 0000',
        notes: 'allergic to lilies',
      })
      .expect(201)

    const booking = await BookingModel.findOne({ sessionId: session._id })
    expect(String(booking!.studentId)).toBe(String(student._id))
    expect(booking!.studentNotes).toBe('allergic to lilies')

    // No second account was invented, and the real one was not renamed.
    expect(await StudentModel.countDocuments()).toBe(1)
    expect((await StudentModel.findById(student._id))!.name).toBe('Real Name')
  })

  it('records who is attending when the place is for someone else', async () => {
    const student = await makeStudent({ name: 'Parent', email: 'parent@example.com', phone: '+65 9222 3333' })

    await request(app)
      .post('/api/bookings/start')
      .set('Cookie', asStudent(String(student._id)))
      .send({ sessionId: String(session._id), attendeeName: 'Their Child' })
      .expect(201)

    const booking = await BookingModel.findOne({ sessionId: session._id })
    expect(booking!.attendeeName).toBe('Their Child')
    // Still one account: the booking, the history and any package stay with the parent.
    expect(String(booking!.studentId)).toBe(String(student._id))
    expect(await StudentModel.countDocuments()).toBe(1)
  })

  it('shows the attendee on the register, and who booked them in', async () => {
    const student = await makeStudent({ name: 'Parent', email: 'parent2@example.com', phone: '+65 9444 5555' })

    await request(app)
      .post('/api/bookings/start')
      .set('Cookie', asStudent(String(student._id)))
      .send({ sessionId: String(session._id), attendeeName: 'Their Child' })
      .expect(201)

    const booking = await BookingModel.findOne({ sessionId: session._id })
    expect(booking!.attendeeName).toBe('Their Child')
  })
})

describe('the three accounts that were really one person', () => {
  /*
   * Reproduced from the studio's own student list. Nothing exact matched any of these, which is
   * why they became three students with three separate course balances.
   */
  it('stops a mistyped domain becoming a second account', async () => {
    await makeStudent({ name: 'Ayesha Akter', email: 'ayeshaakter6100@gmail.com', phone: '0130187508' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Akib Zawayed',
        email: 'ayeshaakter6100@gmal.com',
        phone: '019 0418 7508',
      })
      .expect(200)

    expect(res.body.outcome).toBe('possible_duplicate')
    expect(res.body.reason).toBe('email_similar')
    expect(await StudentModel.countDocuments()).toBe(1)
  })

  it('stops a dropped letter becoming a third account', async () => {
    await makeStudent({ name: 'Ayesha Akter', email: 'ayeshaakter6100@gmail.com', phone: '0130187508' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Ayesha',
        email: 'ayeshaaker6100@gmail.com',
        phone: '08689699',
      })
      .expect(200)

    expect(res.body.outcome).toBe('possible_duplicate')
    expect(await StudentModel.countDocuments()).toBe(1)
  })

  it('lets someone through when they say it is genuinely not them', async () => {
    await makeStudent({ name: 'Ayesha Akter', email: 'ayeshaakter6100@gmail.com', phone: '0130187508' })

    await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Ayesha',
        email: 'ayeshaaker6100@gmail.com',
        phone: '08689699',
        confirmedNewAccount: true,
      })
      .expect(201)

    expect(await StudentModel.countDocuments()).toBe(2)
  })

  it('never lets that answer get past an address we are certain about', async () => {
    await makeStudent({ name: 'Ayesha Akter', email: 'ayeshaakter6100@gmail.com', phone: '0130187508' })

    const res = await request(app)
      .post('/api/bookings/start')
      .send({
        sessionId: String(session._id),
        name: 'Someone',
        email: 'ayeshaakter6100@gmail.com',
        phone: '0999888777',
        // Claiming to be new cannot override an exact match — that one is not a guess.
        confirmedNewAccount: true,
      })
      .expect(200)

    expect(res.body.outcome).toBe('sign_in_required')
    expect(await StudentModel.countDocuments()).toBe(1)
  })
})
