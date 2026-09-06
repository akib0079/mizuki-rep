import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import argon2 from 'argon2'
import { createApp } from '../../app.js'
import { signAdminToken, COOKIE_NAMES } from '../../auth/tokens.js'
import {
  AdminUserModel,
  AuditLogModel,
  BookingModel,
  OutboxModel,
  PackageModel,
  SessionModel,
  StudentModel,
} from '../../models/index.js'
import { createBooking } from '../../services/bookingService.js'
import { makeCourseType, makePackage, makeSession, makeStudent } from '../../test/factories.js'

/**
 * Deleting a student.
 *
 * The interesting part is not the row going away, it is the place they were holding. A booking
 * deleted without releasing its seat leaves the class counting somebody who no longer exists —
 * one place fewer than it has, permanently, and a drift warning every morning.
 */

const app = createApp()
let cookie: string

beforeEach(async () => {
  const admin = await AdminUserModel.create({
    name: 'Studio',
    email: 'studio@mizuki.com.sg',
    passwordHash: 'not-used-here',
    role: 'owner',
    active: true,
  })
  cookie = `${COOKIE_NAMES.admin}=${signAdminToken({
    sub: String(admin._id),
    email: admin.email,
    role: 'owner',
    v: admin.tokenVersion,
  })}`
})

describe('deleting a student', () => {
  it('frees the place they were holding, so the class is not left short', async () => {
    const course = await makeCourseType()
    const session = await makeSession({ courseTypeId: course._id, capacity: 8 })
    const student = await makeStudent({ name: 'Test Entry' })
    await createBooking({ sessionId: session._id, studentId: student._id, source: 'admin_manual' })

    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)

    const res = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(res.body.seatsFreed).toBe(1)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
    expect(await StudentModel.countDocuments({ _id: student._id })).toBe(0)
    expect(await BookingModel.countDocuments({ studentId: student._id })).toBe(0)
  })

  it('does not take a second place off for a booking that was already cancelled', async () => {
    const course = await makeCourseType()
    const session = await makeSession({ courseTypeId: course._id, capacity: 8 })
    const [leaving, staying] = [await makeStudent(), await makeStudent()]

    const booking = await createBooking({
      sessionId: session._id,
      studentId: leaving._id,
      source: 'admin_manual',
    })
    await createBooking({ sessionId: session._id, studentId: staying._id, source: 'admin_manual' })

    // Cancelled bookings released their seat at the time; releasing again would take the
    // place off a student who is really coming.
    booking.booking.status = 'cancelled'
    await booking.booking.save()
    await SessionModel.updateOne({ _id: session._id }, { $inc: { seatsTaken: -1 } })

    const res = await request(app)
      .delete(`/api/admin/students/${leaving._id}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(res.body.seatsFreed).toBe(0)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('takes their course packages with them', async () => {
    const course = await makeCourseType({ bookingMode: 'package' })
    const student = await makeStudent()
    await makePackage(student._id, course._id)

    const res = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(res.body.packagesRemoved).toBe(1)
    expect(await PackageModel.countDocuments({ studentId: student._id })).toBe(0)
  })

  it('does not email them — they asked to be removed, not cancelled on', async () => {
    const course = await makeCourseType()
    const session = await makeSession({ courseTypeId: course._id })
    const student = await makeStudent({ email: 'gone@example.com' })
    await createBooking({ sessionId: session._id, studentId: student._id, source: 'admin_manual' })

    await OutboxModel.deleteMany({})

    await request(app).delete(`/api/admin/students/${student._id}`).set('Cookie', cookie).expect(200)

    expect(await OutboxModel.countDocuments({ to: 'gone@example.com' })).toBe(0)
  })

  it('records who did it, and their details — an id pointing at nothing answers nothing', async () => {
    const student = await makeStudent({ name: 'Typo Entry', email: 'typo@example.com' })

    await request(app).delete(`/api/admin/students/${student._id}`).set('Cookie', cookie).expect(200)

    const entry = await AuditLogModel.findOne({ action: 'student.delete' }).lean()
    expect(entry).toBeTruthy()
    expect(entry!.reason).toContain('typo@example.com')
    expect(entry!.actor).toContain('studio@mizuki.com.sg')
  })

  it('says what would go before anything goes', async () => {
    const course = await makeCourseType({ bookingMode: 'package' })
    // Far enough out that it counts as upcoming whenever this test runs.
    const session = await makeSession({ courseTypeId: course._id, date: '2027-11-20', time: '10:00' })
    const student = await makeStudent({ name: 'Aiko Tan' })
    await makePackage(student._id, course._id, { totalSessions: 8, usedSessions: 2 })
    await createBooking({ sessionId: session._id, studentId: student._id, source: 'admin_manual' })

    const res = await request(app)
      .get(`/api/admin/students/${student._id}/deletion`)
      .set('Cookie', cookie)
      .expect(200)

    expect(res.body.name).toBe('Aiko Tan')
    expect(res.body.upcomingBookings).toHaveLength(1)
    expect(res.body.totalBookings).toBe(1)
    // Eight bought, two already used, and one more consumed by the booking above.
    expect(res.body.unusedSessions).toBe(5)

    // A preview must not have changed anything.
    expect(await StudentModel.countDocuments({ _id: student._id })).toBe(1)
  })

  it('is a 404 for a student who is already gone', async () => {
    const student = await makeStudent()
    await request(app).delete(`/api/admin/students/${student._id}`).set('Cookie', cookie).expect(200)
    await request(app).delete(`/api/admin/students/${student._id}`).set('Cookie', cookie).expect(404)
  })

  it('needs a signed-in admin', async () => {
    const student = await makeStudent()
    await request(app).delete(`/api/admin/students/${student._id}`).expect(401)
    expect(await StudentModel.countDocuments({ _id: student._id })).toBe(1)
  })
})

describe('adding an admin with a password', () => {
  it('lets them sign in straight away, with no invitation to pass on', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set('Cookie', cookie)
      .send({ name: 'Hana Tan', email: 'hana@mizuki.com.sg', password: 'coral-lantern-97' })
      .expect(201)

    expect(res.body.passwordSet).toBe(true)
    expect(res.body.inviteUrl).toBeUndefined()

    const signIn = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'hana@mizuki.com.sg', password: 'coral-lantern-97' })
      .expect(200)
    expect(signIn.body.admin.email).toBe('hana@mizuki.com.sg')
  })

  it('still hands back an invitation when no password is given', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set('Cookie', cookie)
      .send({ name: 'Hana Tan', email: 'hana2@mizuki.com.sg' })
      .expect(201)

    expect(res.body.inviteUrl).toContain('accept-invite?token=')
    expect(res.body.passwordSet).toBeUndefined()
  })

  it('refuses a password too short to be worth setting', async () => {
    await request(app)
      .post('/api/admin/admins')
      .set('Cookie', cookie)
      .send({ name: 'Hana Tan', email: 'hana3@mizuki.com.sg', password: 'short' })
      .expect(400)

    expect(await AdminUserModel.countDocuments({ email: 'hana3@mizuki.com.sg' })).toBe(0)
  })

  it('never stores the password itself', async () => {
    await request(app)
      .post('/api/admin/admins')
      .set('Cookie', cookie)
      .send({ name: 'Hana Tan', email: 'hana4@mizuki.com.sg', password: 'coral-lantern-97' })
      .expect(201)

    const row = await AdminUserModel.findOne({ email: 'hana4@mizuki.com.sg' })
      .select('+passwordHash')
      .lean()
    expect(row!.passwordHash).not.toContain('coral-lantern-97')
    expect(await argon2.verify(row!.passwordHash, 'coral-lantern-97')).toBe(true)
  })

  it('sets a password on someone who already has an account, and signs them out', async () => {
    const created = await request(app)
      .post('/api/admin/admins')
      .set('Cookie', cookie)
      .send({ name: 'Hana Tan', email: 'hana5@mizuki.com.sg', password: 'coral-lantern-97' })
      .expect(201)

    await request(app)
      .post(`/api/admin/admins/${created.body.admin.id}/set-password`)
      .set('Cookie', cookie)
      .send({ password: 'jasmine-window-42' })
      .expect(200)

    await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'hana5@mizuki.com.sg', password: 'coral-lantern-97' })
      .expect(401)

    await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'hana5@mizuki.com.sg', password: 'jasmine-window-42' })
      .expect(200)
  })
})
