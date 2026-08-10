import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  evaluateCancel,
  evaluatePackageUsable,
  evaluateReschedule,
  evaluateSessionBookable,
  isOverCapacity,
  isSessionFull,
  rescheduleDeadline,
  seatsLeft,
  sessionsRemaining,
} from './rules.js'
import { STUDIO_TZ, dateKeyOf, studioInstant, weekdayOf } from './time.js'

/** Build a UTC instant from a studio-local wall clock, the way the seeder does. */
const sgt = (dateKey: string, time: string) => studioInstant(dateKey, time)

const IKEBANA = { name: 'Ikebana', rescheduleCutoffHours: 72, cancelCutoffHours: 72 }
const IFDA = { name: 'IFDA', rescheduleCutoffHours: 24, cancelCutoffHours: 24 }

describe('seat arithmetic', () => {
  it('subtracts both booked and held-back places', () => {
    expect(seatsLeft({ capacity: 8, heldBack: 2, seatsTaken: 3 })).toBe(3)
  })

  it('never reports negative places when an admin shrinks the room', () => {
    expect(seatsLeft({ capacity: 4, heldBack: 0, seatsTaken: 6 })).toBe(0)
    expect(isSessionFull({ capacity: 4, heldBack: 0, seatsTaken: 6 })).toBe(true)
  })

  it('flags over-capacity so the admin console can surface it', () => {
    expect(isOverCapacity({ capacity: 6, heldBack: 0, seatsTaken: 6 })).toBe(false)
    expect(isOverCapacity({ capacity: 6, heldBack: 1, seatsTaken: 6 })).toBe(true)
    expect(isOverCapacity({ capacity: 4, heldBack: 0, seatsTaken: 6 })).toBe(true)
  })

  it('treats held-back places as unavailable to students but not over-capacity', () => {
    const session = { capacity: 8, heldBack: 8, seatsTaken: 0 }
    expect(seatsLeft(session)).toBe(0)
    expect(isSessionFull(session)).toBe(true)
    expect(isOverCapacity(session)).toBe(false)
  })
})

describe('reschedule cutoff', () => {
  it("locks a Saturday Ikebana class on the Wednesday — the client's own example", () => {
    // Sat 22 Aug 2026, 10:00 SGT, Ikebana, 72-hour rule.
    const start = sgt('2026-08-22', '10:00')
    expect(weekdayOf(dateKeyOf(start))).toBe(6) // Saturday

    const deadline = rescheduleDeadline(start, IKEBANA.rescheduleCutoffHours)
    const local = DateTime.fromJSDate(deadline).setZone(STUDIO_TZ)

    expect(local.toFormat('cccc yyyy-MM-dd HH:mm')).toBe('Wednesday 2026-08-19 10:00')
  })

  it('allows an Ikebana change on the Tuesday and refuses it on the Thursday', () => {
    const session = { startAt: sgt('2026-08-22', '10:00'), status: 'scheduled' as const }
    const booking = { status: 'confirmed' as const }

    const tuesday = evaluateReschedule({ booking, session, courseType: IKEBANA }, sgt('2026-08-18', '09:00'))
    expect(tuesday.allowed).toBe(true)

    const thursday = evaluateReschedule({ booking, session, courseType: IKEBANA }, sgt('2026-08-20', '09:00'))
    expect(thursday.allowed).toBe(false)
    expect(thursday.code).toBe('cutoff_passed')
  })

  it('treats the deadline instant itself as closed', () => {
    const session = { startAt: sgt('2026-08-22', '10:00'), status: 'scheduled' as const }
    const booking = { status: 'confirmed' as const }

    const oneMinuteBefore = evaluateReschedule({ booking, session, courseType: IKEBANA }, sgt('2026-08-19', '09:59'))
    expect(oneMinuteBefore.allowed).toBe(true)

    const exactly = evaluateReschedule({ booking, session, courseType: IKEBANA }, sgt('2026-08-19', '10:00'))
    expect(exactly.allowed).toBe(false)
  })

  it('gives IFDA students until 24 hours before', () => {
    // Sun 6 Sep 2026, 14:30 SGT IFDA afternoon session locks Sat 5 Sep 14:30.
    const session = { startAt: sgt('2026-09-06', '14:30'), status: 'scheduled' as const }
    const booking = { status: 'confirmed' as const }

    const deadline = rescheduleDeadline(session.startAt, IFDA.rescheduleCutoffHours)
    expect(DateTime.fromJSDate(deadline).setZone(STUDIO_TZ).toFormat('cccc yyyy-MM-dd HH:mm')).toBe(
      'Saturday 2026-09-05 14:30',
    )

    // Still open two days out, when an Ikebana student would already be locked.
    const twoDaysOut = sgt('2026-09-04', '12:00')
    expect(evaluateReschedule({ booking, session, courseType: IFDA }, twoDaysOut).allowed).toBe(true)
    expect(evaluateReschedule({ booking, session, courseType: IKEBANA }, twoDaysOut).allowed).toBe(false)
  })

  it('returns the deadline so the UI can show it before it passes', () => {
    const session = { startAt: sgt('2026-10-11', '10:00'), status: 'scheduled' as const }
    const result = evaluateReschedule(
      { booking: { status: 'confirmed' }, session, courseType: IKEBANA },
      sgt('2026-10-01', '10:00'),
    )
    expect(result.allowed).toBe(true)
    expect(result.deadline).toEqual(sgt('2026-10-08', '10:00'))
  })

  it('refuses on cancelled sessions, inactive bookings and past classes', () => {
    const now = sgt('2026-08-01', '10:00')
    const base = { startAt: sgt('2026-08-22', '10:00'), status: 'scheduled' as const }

    expect(
      evaluateReschedule(
        { booking: { status: 'confirmed' }, session: { ...base, status: 'cancelled' }, courseType: IKEBANA },
        now,
      ).code,
    ).toBe('session_cancelled')

    expect(
      evaluateReschedule({ booking: { status: 'cancelled' }, session: base, courseType: IKEBANA }, now).code,
    ).toBe('booking_inactive')

    expect(
      evaluateReschedule(
        { booking: { status: 'confirmed' }, session: base, courseType: IKEBANA },
        sgt('2026-08-23', '10:00'),
      ).code,
    ).toBe('session_past')
  })

  it('applies the same cutoff maths to cancellations', () => {
    const session = { startAt: sgt('2026-08-22', '10:00'), status: 'scheduled' as const }
    const booking = { status: 'confirmed' as const }

    expect(evaluateCancel({ booking, session, courseType: IKEBANA }, sgt('2026-08-18', '10:00')).allowed).toBe(true)
    expect(evaluateCancel({ booking, session, courseType: IKEBANA }, sgt('2026-08-20', '10:00')).allowed).toBe(false)
  })
})

describe('session bookability', () => {
  const now = sgt('2026-08-01', '10:00')
  const open = { startAt: sgt('2026-08-22', '10:00'), status: 'scheduled' as const, capacity: 8, heldBack: 0, seatsTaken: 3 }

  it('accepts an open future session', () => {
    expect(evaluateSessionBookable(open, now).allowed).toBe(true)
  })

  it('refuses a full session', () => {
    expect(evaluateSessionBookable({ ...open, seatsTaken: 8 }, now).code).toBe('session_full')
  })

  it('refuses when every remaining place is held back for chat bookings', () => {
    expect(evaluateSessionBookable({ ...open, seatsTaken: 3, heldBack: 5 }, now).code).toBe('session_full')
  })

  it('refuses cancelled and past sessions', () => {
    expect(evaluateSessionBookable({ ...open, status: 'cancelled' }, now).code).toBe('session_cancelled')
    expect(evaluateSessionBookable(open, sgt('2026-08-23', '10:00')).code).toBe('session_past')
  })
})

describe('course packages', () => {
  const courseTypeId = '000000000000000000000001'
  const now = sgt('2026-09-01', '10:00')
  const base = {
    courseTypeId,
    totalSessions: 8,
    usedSessions: 2,
    expiresAt: sgt('2026-12-31', '23:59'),
    status: 'active' as const,
  }

  it('counts down remaining sessions', () => {
    expect(sessionsRemaining(base)).toBe(6)
    expect(evaluatePackageUsable(base, courseTypeId, now).allowed).toBe(true)
  })

  it('refuses once every session is spent', () => {
    expect(evaluatePackageUsable({ ...base, usedSessions: 8 }, courseTypeId, now).code).toBe('package_exhausted')
  })

  it('refuses an expired package and names the date so the studio can extend it', () => {
    const expired = { ...base, expiresAt: sgt('2026-08-01', '23:59') }
    const result = evaluatePackageUsable(expired, courseTypeId, now)
    expect(result.code).toBe('package_expired')
    expect(result.message).toContain('1 Aug 2026')
  })

  it('refuses a package bought for a different course', () => {
    expect(evaluatePackageUsable(base, '000000000000000000000002', now).code).toBe('course_mismatch')
  })

  it('allows a package with no expiry', () => {
    expect(evaluatePackageUsable({ ...base, expiresAt: null }, courseTypeId, now).allowed).toBe(true)
  })
})
