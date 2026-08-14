import type { DateKey } from './time.js'
import type { SessionAvailability } from './rules.js'

/**
 * How a student gets a seat in a class of this course.
 *  - `package` — spends a credit from a pre-bought course block (IFDA, Preserved Flower)
 *  - `paid`    — one-off workshop paid for through the existing WooCommerce shop
 *  - `free`    — trial or invite-only; booked without payment or credit
 */
export type BookingMode = 'package' | 'paid' | 'free'

export type SessionStatus = 'scheduled' | 'cancelled'

/**
 * `hold` is a seat reserved while a student is inside WooCommerce checkout. It occupies
 * a place exactly like a confirmed booking, but expires on its own if payment never lands.
 *
 * `awaiting_confirmation` is the state after the student has paid but before the studio has
 * checked the money actually arrived. It holds the place indefinitely — unlike `hold`, nothing
 * expires it, because someone has paid and their place must not quietly go back on sale.
 */
export type BookingStatus =
  | 'hold'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'cancelled'
  | 'attended'
  | 'no_show'

export type BookingSource = 'student_web' | 'admin_manual' | 'woo_order'

export type PackageStatus = 'active' | 'expired' | 'completed'

export type RecurrenceFreq = 'WEEKLY' | 'NONE'

/*
 * These three sets are the only place booking statuses may be grouped.
 *
 * They were previously written out as literal arrays at seventeen call sites — the capacity
 * queries, the double-booking index, the roster, the closed-date sweep. Adding a status meant
 * finding and editing all seventeen, and the ones that got missed would not fail loudly: a
 * forgotten set in a capacity query undercounts the room and oversells the class, which is the
 * single guarantee this system exists to make. A guard test asserts no such literal comes back.
 */

/** Live bookings: holding a place right now, and blocking the same student booking twice. */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'hold',
  'awaiting_confirmation',
  'confirmed',
]

/** Everyone who took up a place, including classes already taught. */
export const SEAT_OCCUPYING_STATUSES: readonly BookingStatus[] = [
  ...ACTIVE_BOOKING_STATUSES,
  'attended',
]

/** Everyone who should appear on a class register, including those who did not turn up. */
export const ROSTER_STATUSES: readonly BookingStatus[] = [...SEAT_OCCUPYING_STATUSES, 'no_show']

/**
 * People the studio should expect in the room — everyone but a checkout still in progress.
 *
 * Distinct from ACTIVE_BOOKING_STATUSES because `hold` is genuinely uncertain: it is someone
 * part-way through paying who may simply close the tab. Someone awaiting confirmation, by
 * contrast, has paid; only the studio's check of the money is outstanding, and leaving them out
 * of a headcount would have the teacher expecting fewer students than actually turn up.
 */
export const EXPECTED_ATTENDANCE_STATUSES: readonly BookingStatus[] = [
  'awaiting_confirmation',
  'confirmed',
  'attended',
]

export interface CourseType {
  id: string
  name: string
  slug: string
  colour: string
  bookingMode: BookingMode
  /** Hours before class start after which a student can no longer move their booking. 24 for IFDA/Preserved, 72 for Ikebana/Fresh. */
  rescheduleCutoffHours: number
  cancelCutoffHours: number
  defaultDurationMins: number
  defaultCapacity: number
  wooProductIds: number[]
  active: boolean
}

export interface Recurrence {
  freq: RecurrenceFreq
  /** ISO weekdays, 1 = Monday … 7 = Sunday. Only meaningful when freq is WEEKLY. */
  byWeekday: number[]
  interval: number
}

export interface ScheduleRule {
  id: string
  courseTypeId: string
  title: string
  recurrence: Recurrence
  /** Studio-local wall clock, `HH:mm`. */
  startTime: string
  durationMins: number
  capacity: number
  effectiveFrom: DateKey
  effectiveTo: DateKey | null
  active: boolean
}

export interface SessionBreak {
  /** Studio-local wall clock, `HH:mm`. The Bouquet day runs 10:00–17:00 with lunch 13:00–14:30. */
  start: string
  end: string
  label: string
}

export interface Session {
  id: string
  courseTypeId: string
  scheduleRuleId: string | null
  startAt: Date
  endAt: Date
  capacity: number
  /** Places withheld from public sale so the studio can fill them from chat enquiries. The admin "minus" button. */
  heldBack: number
  /** Denormalised count of seat-occupying bookings. Only ever moved by the seat service. */
  seatsTaken: number
  breaks: SessionBreak[]
  status: SessionStatus
  title: string
  notes: string
  /** Fields edited by hand on this occurrence, which rule regeneration must never overwrite. */
  overriddenFields: string[]
}

export interface ClosedDate {
  id: string
  startDate: DateKey
  endDate: DateKey
  reason: string
}

export interface Student {
  id: string
  name: string
  email: string
  phone: string
  notes: string
  marketingOptIn: boolean
}

export interface PackageLedgerEntry {
  type: 'grant' | 'consume' | 'refund' | 'adjust' | 'extend'
  delta: number
  bookingId: string | null
  note: string
  at: Date
  by: string
}

export interface CoursePackage {
  id: string
  studentId: string
  courseTypeId: string
  totalSessions: number
  usedSessions: number
  expiresAt: Date | null
  status: PackageStatus
  ledger: PackageLedgerEntry[]
}

export interface Booking {
  id: string
  sessionId: string
  studentId: string
  status: BookingStatus
  source: BookingSource
  packageId: string | null
  wooOrderId: number | null
  holdExpiresAt: Date | null
  rescheduledFrom: string | null
}

/** What the public calendar returns for one session — never exposes rosters or student data. */
export interface PublicSession {
  id: string
  courseTypeId: string
  courseName: string
  colour: string
  title: string
  startAt: string
  endAt: string
  durationMins: number
  breaks: SessionBreak[]
  seatsLeft: number
  isFull: boolean
  /** Three states rather than a count: what the student is actually told. */
  availability: SessionAvailability
  bookingMode: BookingMode
}

export interface PublicCalendarDay {
  date: DateKey
  isClosed: boolean
  sessions: PublicSession[]
}
