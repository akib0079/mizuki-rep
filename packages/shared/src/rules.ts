import type { Booking, CoursePackage, CourseType, Session } from './types.js'
import { SEAT_OCCUPYING_STATUSES } from './types.js'
import { formatSessionDateTime, subtractHours } from './time.js'

/**
 * The booking rulebook. Both the widget and the API import these — the widget to decide
 * what to grey out, the API to decide what to allow. The API is always the authority:
 * a disabled button is a courtesy, never a control.
 */

export type RuleCode =
  | 'ok'
  | 'session_cancelled'
  | 'session_past'
  | 'session_full'
  | 'booking_inactive'
  | 'cutoff_passed'
  | 'package_exhausted'
  | 'package_expired'
  | 'course_mismatch'
  | 'already_booked'

export interface RuleResult {
  allowed: boolean
  code: RuleCode
  /** Student-facing explanation. Safe to render directly. */
  message: string
  /** For cutoff rules: the instant after which the action stops being possible. */
  deadline?: Date
}

const ok = (): RuleResult => ({ allowed: true, code: 'ok', message: '' })

const deny = (code: RuleCode, message: string, deadline?: Date): RuleResult => ({
  allowed: false,
  code,
  message,
  ...(deadline ? { deadline } : {}),
})

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/**
 * Places a student can actually book right now.
 *
 * `heldBack` is subtracted because those places are deliberately withheld for chat
 * bookings. Clamped at zero so an admin lowering capacity below current bookings
 * shows "0 left" to students rather than a negative number — the over-capacity
 * state is surfaced to the admin separately via `isOverCapacity`.
 */
export function seatsLeft(session: Pick<Session, 'capacity' | 'heldBack' | 'seatsTaken'>): number {
  return Math.max(0, session.capacity - session.heldBack - session.seatsTaken)
}

export function isSessionFull(session: Pick<Session, 'capacity' | 'heldBack' | 'seatsTaken'>): boolean {
  return seatsLeft(session) === 0
}

/**
 * Whether a student can book this class, as three states rather than a number.
 *
 * "Full" and "not available" look identical from a seat count — both leave nothing to book — but
 * they mean different things and lead to different actions. Full is the room; not available is
 * the studio holding the remaining places back for people booking over chat, or having cancelled
 * the class. Someone told "full" looks for another date; someone told "not available" might well
 * ring up, and should.
 */
export type SessionAvailability = 'available' | 'unavailable' | 'full'

export function sessionAvailability(
  session: Pick<Session, 'capacity' | 'heldBack' | 'seatsTaken'> & { status?: string },
): SessionAvailability {
  if (session.status === 'cancelled') return 'unavailable'
  if (seatsLeft(session) > 0) return 'available'
  // Every place in the room is taken by a person, not withheld.
  if (session.seatsTaken >= session.capacity) return 'full'
  return 'unavailable'
}

/**
 * True when more people are booked than the room now holds. Reachable only by an admin
 * lowering capacity after bookings exist — which we allow, because refusing would leave
 * them unable to record a real-world room change. The admin console shows a banner and
 * makes them choose who moves; nothing is ever dropped automatically.
 */
export function isOverCapacity(session: Pick<Session, 'capacity' | 'heldBack' | 'seatsTaken'>): boolean {
  return session.seatsTaken + session.heldBack > session.capacity
}

export function occupiesSeat(status: Booking['status']): boolean {
  return SEAT_OCCUPYING_STATUSES.includes(status)
}

// ---------------------------------------------------------------------------
// Reschedule / cancel cutoffs
// ---------------------------------------------------------------------------

/**
 * The instant a student loses the ability to move their booking.
 *
 * Measured in exact hours back from the class start, so with the studio's 72-hour rule a
 * Saturday 10:00 Ikebana class locks at Wednesday 10:00 — which is the client's own example
 * of "a Saturday Ikebana class locks on the Wednesday". Preserved Flower and IFDA use 24.
 * The number lives on CourseType, so changing the policy is an admin edit, not a deploy.
 */
export function rescheduleDeadline(startAt: Date, cutoffHours: number): Date {
  return subtractHours(startAt, cutoffHours)
}

export interface RescheduleContext {
  booking: Pick<Booking, 'status'>
  session: Pick<Session, 'startAt' | 'status'>
  courseType: Pick<CourseType, 'rescheduleCutoffHours' | 'name'>
}

export function evaluateReschedule(ctx: RescheduleContext, now: Date): RuleResult {
  const { booking, session, courseType } = ctx

  if (session.status === 'cancelled') {
    return deny('session_cancelled', 'This class has been cancelled. Please contact us to rebook.')
  }
  if (booking.status !== 'confirmed' && booking.status !== 'hold') {
    return deny('booking_inactive', 'This booking is no longer active.')
  }
  if (session.startAt.getTime() <= now.getTime()) {
    return deny('session_past', 'This class has already started.')
  }

  const deadline = rescheduleDeadline(session.startAt, courseType.rescheduleCutoffHours)
  if (now.getTime() >= deadline.getTime()) {
    return deny(
      'cutoff_passed',
      `${courseType.name} bookings can no longer be changed — the deadline was ${formatSessionDateTime(deadline)}. Please get in touch and we will do our best to help.`,
      deadline,
    )
  }

  return { ...ok(), deadline }
}

export function evaluateCancel(
  ctx: { booking: Pick<Booking, 'status'>; session: Pick<Session, 'startAt' | 'status'>; courseType: Pick<CourseType, 'cancelCutoffHours' | 'name'> },
  now: Date,
): RuleResult {
  const { booking, session, courseType } = ctx

  if (booking.status !== 'confirmed' && booking.status !== 'hold') {
    return deny('booking_inactive', 'This booking is no longer active.')
  }
  if (session.startAt.getTime() <= now.getTime()) {
    return deny('session_past', 'This class has already started.')
  }

  const deadline = rescheduleDeadline(session.startAt, courseType.cancelCutoffHours)
  if (now.getTime() >= deadline.getTime()) {
    return deny(
      'cutoff_passed',
      `${courseType.name} bookings can no longer be cancelled — the deadline was ${formatSessionDateTime(deadline)}.`,
      deadline,
    )
  }

  return { ...ok(), deadline }
}

// ---------------------------------------------------------------------------
// Booking eligibility
// ---------------------------------------------------------------------------

/** Whether a session can take another student. Checked client-side for UI, re-checked atomically on write. */
export function evaluateSessionBookable(
  session: Pick<Session, 'startAt' | 'status' | 'capacity' | 'heldBack' | 'seatsTaken'>,
  now: Date,
): RuleResult {
  if (session.status === 'cancelled') {
    return deny('session_cancelled', 'This class has been cancelled.')
  }
  if (session.startAt.getTime() <= now.getTime()) {
    return deny('session_past', 'This class has already started.')
  }
  if (isSessionFull(session)) {
    return deny('session_full', 'This class is full.')
  }
  return ok()
}

/** Whether a package can pay for one more session. */
export function evaluatePackageUsable(
  pkg: Pick<CoursePackage, 'courseTypeId' | 'totalSessions' | 'usedSessions' | 'expiresAt' | 'status'>,
  courseTypeId: string,
  now: Date,
): RuleResult {
  if (pkg.courseTypeId !== courseTypeId) {
    return deny('course_mismatch', 'This course package cannot be used for this class.')
  }
  if (pkg.status !== 'active') {
    return deny('package_expired', 'This course package is no longer active.')
  }
  if (pkg.expiresAt && pkg.expiresAt.getTime() <= now.getTime()) {
    return deny(
      'package_expired',
      `This course package expired on ${formatSessionDateTime(pkg.expiresAt)}. Please contact us to extend it.`,
    )
  }
  if (sessionsRemaining(pkg) <= 0) {
    return deny('package_exhausted', 'You have used all the sessions in this course package.')
  }
  return ok()
}

export function sessionsRemaining(pkg: Pick<CoursePackage, 'totalSessions' | 'usedSessions'>): number {
  return Math.max(0, pkg.totalSessions - pkg.usedSessions)
}
