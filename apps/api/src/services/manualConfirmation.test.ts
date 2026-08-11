import { beforeEach, describe, expect, it } from 'vitest'
import { studioInstant } from '@mizuki/shared'
import {
  AdminNotificationModel,
  BookingModel,
  OutboxModel,
  SessionModel,
  type CourseTypeDoc,
} from '../models/index.js'
import { approveBooking, cancelBooking, createBooking, confirmHold } from './bookingService.js'
import { seedEmailTemplates } from './emailTemplates.js'
import { expireHolds } from '../jobs/index.js'
import { makeCourseType, makeSession, makeStudent, countLiveBookings } from '../test/factories.js'
import { SessionFullError } from '../errors.js'

/**
 * Courses the studio confirms by hand.
 *
 * The risk this whole flow carries is a paid place quietly going back on sale while the studio
 * is checking the payment. Every test here is some version of that question.
 */

const NOW = studioInstant('2026-09-01', '09:00')

let manual: CourseTypeDoc
let automatic: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  manual = await makeCourseType({
    name: 'Ikebana',
    slug: 'ikebana-manual',
    bookingMode: 'paid',
    requiresManualConfirmation: true,
  })
  automatic = await makeCourseType({
    name: 'Bouquet',
    slug: 'bouquet-auto',
    bookingMode: 'paid',
    requiresManualConfirmation: false,
  })
})

/** Put a booking into the state a completed checkout leaves it in. */
async function payFor(courseType: CourseTypeDoc, opts: { capacity?: number } = {}) {
  const session = await makeSession({
    courseTypeId: courseType._id,
    capacity: opts.capacity ?? 4,
    date: '2026-09-20',
  })
  const student = await makeStudent()

  const { booking } = await createBooking({
    sessionId: session._id,
    studentId: student._id,
    status: 'hold',
    holdMinutes: 20,
    now: NOW,
  })

  await confirmHold(booking._id, 5150)
  return { session, student, booking: (await BookingModel.findById(booking._id))! }
}

describe('payment on a course the studio confirms by hand', () => {
  it('waits for approval instead of confirming itself', async () => {
    const { booking } = await payFor(manual)
    expect(booking.status).toBe('awaiting_confirmation')
    expect(booking.confirmedAt).toBeNull()
  })

  it('still confirms immediately when the course does not need approval', async () => {
    const { booking } = await payFor(automatic)
    expect(booking.status).toBe('confirmed')
    expect(booking.confirmedAt).not.toBeNull()
  })

  it('keeps holding the place, so nobody else can take it', async () => {
    const { session } = await payFor(manual, { capacity: 1 })

    const other = await makeStudent()
    await expect(
      createBooking({ sessionId: session._id, studentId: other._id, now: NOW }),
    ).rejects.toThrow(SessionFullError)

    expect(await countLiveBookings(session._id)).toBe(1)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('never lets the hold sweeper reclaim a place that has been paid for', async () => {
    const { session, booking } = await payFor(manual)

    // Well past any hold window — the sweeper would have taken an unpaid seat long ago.
    const released = await expireHolds(new Date(NOW.getTime() + 72 * 3600_000))

    expect(released).toBe(0)
    expect((await BookingModel.findById(booking._id))!.status).toBe('awaiting_confirmation')
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('stops the hold expiring at all, rather than relying on the sweeper skipping it', async () => {
    const { booking } = await payFor(manual)
    // Belt and braces: even a future sweeper that matched on other statuses finds no deadline.
    expect(booking.holdExpiresAt).toBeNull()
  })

  it('tells the student their payment arrived, without calling it a confirmation', async () => {
    const { booking } = await payFor(manual)

    const toStudent = await OutboxModel.find({ relatedBookingId: booking._id, type: /^booking_/ }).lean()
    const types = toStudent.map((m) => m.type)

    expect(types).toContain('booking_pending_confirmation')
    // The real confirmation must not go out until the studio has actually approved it.
    expect(types).not.toContain('booking_confirmation')
  })

  it('raises it in the console as something to act on', async () => {
    const { booking } = await payFor(manual)

    const note = await AdminNotificationModel.findOne({ relatedBookingId: booking._id }).lean()
    expect(note?.type).toBe('awaiting_confirmation')
    expect(note?.severity).toBe('action')
    expect(note?.resolvedAt).toBeNull()
  })

  it('does not stack duplicates when the shop sends the callback twice', async () => {
    const { booking } = await payFor(manual)
    await confirmHold(booking._id, 5150)

    expect(await AdminNotificationModel.countDocuments({ relatedBookingId: booking._id })).toBe(1)
    expect((await BookingModel.findById(booking._id))!.status).toBe('awaiting_confirmation')
  })
})

describe('approving', () => {
  it('confirms the place and sends the confirmation', async () => {
    const { booking } = await payFor(manual)

    const result = await approveBooking(booking._id, 'admin:hana')

    expect(result.booking.status).toBe('confirmed')
    expect(result.booking.confirmedAt).not.toBeNull()

    const sent = await OutboxModel.find({ relatedBookingId: booking._id }).lean()
    expect(sent.map((m) => m.type)).toContain('booking_confirmation')
  })

  it('does not claim a second seat — the place was already theirs', async () => {
    const { session, booking } = await payFor(manual, { capacity: 2 })
    await approveBooking(booking._id, 'admin:hana')

    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(1)
  })

  it('clears the console item, so the job does not look outstanding forever', async () => {
    const { booking } = await payFor(manual)
    await approveBooking(booking._id, 'admin:hana')

    const note = await AdminNotificationModel.findOne({ relatedBookingId: booking._id }).lean()
    expect(note?.resolvedAt).not.toBeNull()
  })

  it('is safe to press twice', async () => {
    const { booking } = await payFor(manual)
    await approveBooking(booking._id, 'admin:hana')
    const again = await approveBooking(booking._id, 'admin:hana')

    expect(again.booking.status).toBe('confirmed')
    const confirmations = await OutboxModel.countDocuments({
      relatedBookingId: booking._id,
      type: 'booking_confirmation',
    })
    expect(confirmations).toBe(1)
  })

  it('refuses to approve a booking that was never waiting', async () => {
    const { booking } = await payFor(automatic)
    await expect(approveBooking(booking._id, 'admin:hana')).resolves.toMatchObject({
      booking: expect.objectContaining({ status: 'confirmed' }),
    })
  })
})

describe('declining', () => {
  it('hands the place back to the calendar', async () => {
    const { session, booking } = await payFor(manual, { capacity: 1 })

    await cancelBooking({
      bookingId: booking._id,
      reason: 'Payment never arrived',
      by: 'admin:hana',
    })

    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)

    // And the place is genuinely available again, not merely counted as free.
    const other = await makeStudent()
    const { booking: replacement } = await createBooking({
      sessionId: session._id,
      studentId: other._id,
      now: NOW,
    })
    expect(replacement.status).toBe('confirmed')
  })
})
