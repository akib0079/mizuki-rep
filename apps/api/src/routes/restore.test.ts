import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import argon2 from 'argon2'
import { createApp } from '../app.js'
import { AdminUserModel, BookingModel, SessionModel, type CourseTypeDoc } from '../models/index.js'
import { createBooking } from '../services/bookingService.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { makeCourseType, makeSession, makeStudents } from '../test/factories.js'

/**
 * Putting a cancelled class back on.
 *
 * Cancelling is the destructive action most likely to be reached for by mistake — one wrong
 * click on a Saturday with students booked. These check that undo really restores the class
 * *and* the people who were in it, and is honest when it cannot.
 */
const app = createApp()
const agent = request.agent(app)

let ikebana: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  ikebana = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid' })

  await AdminUserModel.create({
    name: 'Studio',
    email: 'studio@example.com',
    passwordHash: await argon2.hash('a-long-enough-password', { type: argon2.argon2id }),
    role: 'owner',
    active: true,
  })
  await agent.post('/api/auth/admin/login').send({ email: 'studio@example.com', password: 'a-long-enough-password' }).expect(200)
})

async function cancelledSessionWith(studentCount: number, capacity = 6) {
  const session = await makeSession({ courseTypeId: ikebana._id, capacity, date: '2026-10-17' })
  const students = await makeStudents(studentCount)

  for (const student of students) {
    await createBooking({ sessionId: session._id, studentId: student._id, usePackage: false, notify: false })
  }

  await agent.post(`/api/admin/sessions/${session._id}/cancel`).send({ reason: 'Mistake', notifyStudents: false }).expect(200)

  return { session, students }
}

describe('undoing a cancelled class', () => {
  it('puts the class back on and re-books everyone who was in it', async () => {
    const { session } = await cancelledSessionWith(3)

    expect((await SessionModel.findById(session._id))!.status).toBe('cancelled')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)

    const res = await agent.post(`/api/admin/sessions/${session._id}/restore`).send({ rebookStudents: true }).expect(200)

    expect(res.body.studentsRestored).toBe(3)
    expect(res.body.couldNotFit).toHaveLength(0)

    const restored = await SessionModel.findById(session._id)
    expect(restored!.status).toBe('scheduled')
    expect(restored!.seatsTaken).toBe(3)
    expect(await BookingModel.countDocuments({ sessionId: session._id, status: 'confirmed' })).toBe(3)
  })

  it('can put the class back without re-booking anyone', async () => {
    const { session } = await cancelledSessionWith(2)

    const res = await agent.post(`/api/admin/sessions/${session._id}/restore`).send({ rebookStudents: false }).expect(200)

    expect(res.body.studentsRestored).toBe(0)
    expect((await SessionModel.findById(session._id))!.status).toBe('scheduled')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })

  it('names anyone who no longer fits rather than silently dropping them', async () => {
    const { session } = await cancelledSessionWith(4)

    // The studio shrank the room while the class was off.
    await SessionModel.updateOne({ _id: session._id }, { $set: { capacity: 2 } })

    const res = await agent.post(`/api/admin/sessions/${session._id}/restore`).send({ rebookStudents: true }).expect(200)

    expect(res.body.studentsRestored).toBe(2)
    expect(res.body.couldNotFit).toHaveLength(2)
    expect(res.body.couldNotFit[0]).toHaveProperty('email')

    // Never exceeds the class size, even while undoing.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(2)
  })

  it('does not re-book someone who had cancelled themselves beforehand', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })
    const [staying, leaving] = await makeStudents(2)

    await createBooking({ sessionId: session._id, studentId: staying!._id, usePackage: false, notify: false })
    const theirs = await createBooking({ sessionId: session._id, studentId: leaving!._id, usePackage: false, notify: false })

    // This student dropped out on their own before the studio cancelled the class.
    await agent.post(`/api/admin/students/bookings/${theirs.booking._id}/cancel`).send({ reason: 'Changed my mind' }).expect(200)
    await agent.post(`/api/admin/sessions/${session._id}/cancel`).send({ reason: '', notifyStudents: false }).expect(200)

    const res = await agent.post(`/api/admin/sessions/${session._id}/restore`).send({ rebookStudents: true }).expect(200)

    // Only the student the studio removed comes back.
    expect(res.body.studentsRestored).toBe(1)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('refuses to restore a class that is not cancelled', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-10-17' })

    const res = await agent.post(`/api/admin/sessions/${session._id}/restore`).send({}).expect(409)
    expect(res.body.error.code).toBe('not_cancelled')
  })

  it('refuses to restore a class in the past', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-01' })
    await SessionModel.updateOne({ _id: session._id }, { $set: { status: 'cancelled' } })

    const res = await agent.post(`/api/admin/sessions/${session._id}/restore`).send({}).expect(422)
    expect(res.body.error.code).toBe('session_past')
  })

  it('records the restore in the audit log', async () => {
    const { session } = await cancelledSessionWith(1)
    await agent.post(`/api/admin/sessions/${session._id}/restore`).send({ rebookStudents: true }).expect(200)

    const audit = await agent.get('/api/admin/settings/audit?limit=50').expect(200)
    const actions = audit.body.entries.map((e: { action: string }) => e.action)

    expect(actions).toContain('session.restore')
    expect(actions).toContain('session.cancel')
  })
})

describe('the audit log', () => {
  it('records a capacity override so it is never invisible', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-10-17' })
    const [first, second] = await makeStudents(2)

    await createBooking({ sessionId: session._id, studentId: first!._id, usePackage: false, notify: false })

    await agent
      .post('/api/admin/students/bookings')
      .send({ sessionId: String(session._id), studentId: String(second!._id), overrideCapacity: true, usePackage: false })
      .expect(201)

    const audit = await agent.get('/api/admin/settings/audit?limit=50').expect(200)
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toContain('booking.create.override')
  })
})
