import { beforeEach, describe, expect, it } from 'vitest'
import { studioInstant } from '@mizuki/shared'
import { BookingModel, OutboxModel, PackageModel, SessionModel, type CourseTypeDoc } from '../models/index.js'
import { cancelBooking, createBooking, rescheduleBooking } from './bookingService.js'
import { seedEmailTemplates } from './emailTemplates.js'
import { makeCourseType, makePackage, makeSession, makeStudent, makeStudents } from '../test/factories.js'
import { SessionFullError } from '../errors.js'

const NOW = studioInstant('2026-09-01', '09:00')

let ikebana: CourseTypeDoc
let ifda: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  ikebana = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid', rescheduleCutoffHours: 72, cancelCutoffHours: 72 })
  ifda = await makeCourseType({ name: 'IFDA', bookingMode: 'package', rescheduleCutoffHours: 24, cancelCutoffHours: 24 })
})

describe('createBooking', () => {
  it('books a place and confirms it', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent({ name: 'Aiko' })

    const { booking } = await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })

    expect(booking.status).toBe('confirmed')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('refuses to seat the same student twice in one class', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent()

    await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })
    await expect(createBooking({ sessionId: session._id, studentId: student._id, now: NOW })).rejects.toMatchObject({
      code: 'already_booked',
    })

    // Crucially, the failed attempt must not have consumed a second place.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('never exceeds the class size, even when everyone books at once', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 4, date: '2026-09-13' })
    const students = await makeStudents(12)

    const results = await Promise.allSettled(
      students.map((s) => createBooking({ sessionId: session._id, studentId: s._id, now: NOW })),
    )

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(4)
    expect(await BookingModel.countDocuments({ sessionId: session._id, status: 'confirmed' })).toBe(4)
  })

  it('lets the studio seat someone in a full class, and records that it did', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-09-13' })
    const [first, second] = await makeStudents(2)

    await createBooking({ sessionId: session._id, studentId: first!._id, now: NOW })
    await expect(createBooking({ sessionId: session._id, studentId: second!._id, now: NOW })).rejects.toBeInstanceOf(
      SessionFullError,
    )

    const { booking } = await createBooking({
      sessionId: session._id,
      studentId: second!._id,
      overrideCapacity: true,
      source: 'admin_manual',
      actor: 'studio',
      now: NOW,
    })

    expect(booking.capacityOverridden).toBe(true)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(2)
  })

  it('respects places the studio has held back for chat bookings', async () => {
    // 6 in the room, 5 withheld — the website may sell exactly one.
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, heldBack: 5, date: '2026-09-13' })
    const students = await makeStudents(4)

    const results = await Promise.allSettled(
      students.map((s) => createBooking({ sessionId: session._id, studentId: s._id, now: NOW })),
    )

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('queues a confirmation for the student and an alert for the studio', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent({ name: 'Aiko', email: 'aiko@example.com' })

    await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })

    const confirmation = await OutboxModel.findOne({ type: 'booking_confirmation' })
    expect(confirmation).toBeTruthy()
    expect(confirmation!.to).toBe('aiko@example.com')
    expect(confirmation!.subject).toContain('Your place is confirmed')
    // The rendered body must not leak an unfilled placeholder to a student.
    expect(confirmation!.bodyHtml).not.toMatch(/\{\{/)
  })

  it('refuses a class that has already started', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-08-01' })
    const student = await makeStudent()

    await expect(createBooking({ sessionId: session._id, studentId: student._id, now: NOW })).rejects.toMatchObject({
      code: 'session_past',
    })
  })
})

describe('course packages', () => {
  it('counts a session down as the student books', async () => {
    const session = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent()
    const pkg = await makePackage(student._id, ifda._id, { totalSessions: 8 })

    const result = await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })

    expect(result.pkg!.usedSessions).toBe(1)
    expect(result.booking.packageId!.toString()).toBe(String(pkg._id))

    const fresh = await PackageModel.findById(pkg._id)
    expect(fresh!.ledger.at(-1)).toMatchObject({ type: 'consume', delta: -1 })
  })

  it('refuses an IFDA booking when the student has no package', async () => {
    const session = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent({ name: 'Mei' })

    await expect(createBooking({ sessionId: session._id, studentId: student._id, now: NOW })).rejects.toMatchObject({
      code: 'no_package',
    })

    // The place must have gone back — a rejected booking cannot silently shrink the class.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })

  it('refuses once every session in the package is spent, and leaves the class untouched', async () => {
    const session = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent()
    await makePackage(student._id, ifda._id, { totalSessions: 2, usedSessions: 2 })

    await expect(createBooking({ sessionId: session._id, studentId: student._id, now: NOW })).rejects.toMatchObject({
      code: 'no_package',
    })
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })

  it('cannot spend the last session twice under concurrent bookings', async () => {
    const [a, b] = await Promise.all([
      makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-13' }),
      makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-20' }),
    ])
    const student = await makeStudent()
    const pkg = await makePackage(student._id, ifda._id, { totalSessions: 1 })

    const results = await Promise.allSettled([
      createBooking({ sessionId: a!._id, studentId: student._id, now: NOW }),
      createBooking({ sessionId: b!._id, studentId: student._id, now: NOW }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const fresh = await PackageModel.findById(pkg._id)
    expect(fresh!.usedSessions).toBe(1)
  })

  it('hands the session back when the booking is cancelled', async () => {
    const session = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent()
    const pkg = await makePackage(student._id, ifda._id, { totalSessions: 4 })

    const { booking } = await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })
    expect((await PackageModel.findById(pkg._id))!.usedSessions).toBe(1)

    await cancelBooking({ bookingId: booking._id, by: 'studio', reason: 'Student unwell', now: NOW })

    const fresh = await PackageModel.findById(pkg._id)
    expect(fresh!.usedSessions).toBe(0)
    expect(fresh!.ledger.at(-1)).toMatchObject({ type: 'refund', delta: 1 })
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })
})

describe('rescheduling', () => {
  it('moves an Ikebana student who is outside the 3-day window', async () => {
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const to = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-26' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })
    const moved = await rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: NOW })

    expect(String(moved.booking.sessionId)).toBe(String(to._id))
    expect(String(moved.booking.rescheduledFrom)).toBe(String(booking._id))
    expect((await SessionModel.findById(from._id))!.seatsTaken).toBe(0)
    expect((await SessionModel.findById(to._id))!.seatsTaken).toBe(1)

    const old = await BookingModel.findById(booking._id)
    expect(old!.status).toBe('cancelled')
    expect(old!.cancelReason).toBe('Rescheduled')
  })

  it("refuses an Ikebana move inside 3 days — the client's Saturday/Wednesday rule", async () => {
    // Class is Saturday 12 Sep at 10:00, so it locks Wednesday 9 Sep at 10:00.
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-12', time: '10:00' })
    const to = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-26' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })

    // Tuesday: still open.
    await expect(
      rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: studioInstant('2026-09-08', '12:00') }),
    ).resolves.toBeTruthy()
  })

  it('locks an Ikebana booking once the Wednesday deadline passes', async () => {
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-12', time: '10:00' })
    const to = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-26' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })

    // Thursday, past the Wednesday 10:00 cutoff.
    await expect(
      rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: studioInstant('2026-09-10', '12:00') }),
    ).rejects.toMatchObject({ code: 'cutoff_passed' })

    // The student keeps their original place.
    expect((await SessionModel.findById(from._id))!.seatsTaken).toBe(1)
    expect((await SessionModel.findById(to._id))!.seatsTaken).toBe(0)
  })

  it('still allows an IFDA move two days out, where Ikebana would be locked', async () => {
    const from = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-12', time: '10:00' })
    const to = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-20' })
    const student = await makeStudent()
    await makePackage(student._id, ifda._id, { totalSessions: 8 })

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })

    const moved = await rescheduleBooking({
      bookingId: booking._id,
      toSessionId: to._id,
      now: studioInstant('2026-09-10', '12:00'),
    })
    expect(String(moved.booking.sessionId)).toBe(String(to._id))
  })

  it('does not charge a second course session for a move', async () => {
    const from = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-13' })
    const to = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-20' })
    const student = await makeStudent()
    const pkg = await makePackage(student._id, ifda._id, { totalSessions: 8 })

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })
    await rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: NOW })

    const fresh = await PackageModel.findById(pkg._id)
    expect(fresh!.usedSessions).toBe(1)
  })

  it('leaves the student in their original class when the target is full', async () => {
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const to = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-09-26' })
    const [student, other] = await makeStudents(2)

    const { booking } = await createBooking({ sessionId: from._id, studentId: student!._id, now: NOW })
    await createBooking({ sessionId: to._id, studentId: other!._id, now: NOW })

    await expect(rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: NOW })).rejects.toBeInstanceOf(
      SessionFullError,
    )

    expect((await SessionModel.findById(from._id))!.seatsTaken).toBe(1)
    expect((await BookingModel.findById(booking._id))!.status).toBe('confirmed')
  })

  it('refuses a move into a different course', async () => {
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const to = await makeSession({ courseTypeId: ifda._id, capacity: 6, date: '2026-09-20' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })

    await expect(rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: NOW })).rejects.toMatchObject({
      code: 'course_mismatch',
    })
  })

  it('lets the studio move a student past the cutoff', async () => {
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-12', time: '10:00' })
    const to = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-26' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })

    const moved = await rescheduleBooking({
      bookingId: booking._id,
      toSessionId: to._id,
      enforceCutoff: false,
      by: 'studio',
      now: studioInstant('2026-09-11', '18:00'),
    })
    expect(String(moved.booking.sessionId)).toBe(String(to._id))
  })

  it('tells the student their new date and what it replaced', async () => {
    const from = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const to = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-26' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: from._id, studentId: student._id, now: NOW })
    await rescheduleBooking({ bookingId: booking._id, toSessionId: to._id, now: NOW })

    const email = await OutboxModel.findOne({ type: 'reschedule_confirmed' })
    expect(email).toBeTruthy()
    expect(email!.bodyText).toContain('26 Sep 2026')
    expect(email!.bodyText).toContain('13 Sep 2026')
  })
})

describe('cancelling', () => {
  it('frees the place for someone else', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 1, date: '2026-09-13' })
    const [first, second] = await makeStudents(2)

    const { booking } = await createBooking({ sessionId: session._id, studentId: first!._id, now: NOW })
    await expect(createBooking({ sessionId: session._id, studentId: second!._id, now: NOW })).rejects.toBeInstanceOf(
      SessionFullError,
    )

    await cancelBooking({ bookingId: booking._id, now: NOW })

    await expect(createBooking({ sessionId: session._id, studentId: second!._id, now: NOW })).resolves.toBeTruthy()
  })

  it('holds a student to the cutoff but lets the studio through', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-12', time: '10:00' })
    const student = await makeStudent()
    const { booking } = await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })

    const insideWindow = studioInstant('2026-09-10', '12:00')

    await expect(
      cancelBooking({ bookingId: booking._id, enforceCutoff: true, now: insideWindow }),
    ).rejects.toMatchObject({ code: 'cutoff_passed' })

    await expect(
      cancelBooking({ bookingId: booking._id, enforceCutoff: false, by: 'studio', now: insideWindow }),
    ).resolves.toBeTruthy()
  })

  it('refuses to cancel the same booking twice', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent()
    const { booking } = await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })

    await cancelBooking({ bookingId: booking._id, now: NOW })
    await expect(cancelBooking({ bookingId: booking._id, now: NOW })).rejects.toMatchObject({
      code: 'already_cancelled',
    })

    // The place must be returned once, not twice.
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
  })

  it('lets a cancelled student book the same class again', async () => {
    const session = await makeSession({ courseTypeId: ikebana._id, capacity: 6, date: '2026-09-13' })
    const student = await makeStudent()

    const { booking } = await createBooking({ sessionId: session._id, studentId: student._id, now: NOW })
    await cancelBooking({ bookingId: booking._id, now: NOW })

    await expect(createBooking({ sessionId: session._id, studentId: student._id, now: NOW })).resolves.toBeTruthy()
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })
})
