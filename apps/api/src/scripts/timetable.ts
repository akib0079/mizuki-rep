import type { DateKey } from '@mizuki/shared'

/**
 * The studio's real timetable, as supplied by the client (August–November 2026).
 *
 * Kept as data rather than buried in the seed script so it can be read and corrected by
 * someone who is not reading code. Every date below was checked against the 2026 calendar:
 * each "weekend session" does fall on a Saturday or Sunday.
 *
 * CAPACITY IS A PLACEHOLDER. The client has not yet given per-course class sizes, so every
 * entry uses PLACEHOLDER_CAPACITY. It is editable per session in the admin console, and the
 * real numbers should be set there (or here, then re-seeded) before the calendar goes public.
 */
export const PLACEHOLDER_CAPACITY = 8

/** Session lengths, from the times the client gave. */
export const DURATIONS = {
  /** 10:00–13:00 */
  morning3h: 180,
  /** 14:30–17:00 */
  afternoon2h30: 150,
  /** 19:00–21:30 */
  evening2h30: 150,
  /** 10:00–12:30 */
  ikebanaMorning2h30: 150,
  /** 10:00–17:00, lunch 13:00–14:30 */
  bouquetFullDay: 420,
} as const

export const LUNCH_BREAK = [{ start: '13:00', end: '14:30', label: 'Lunch' }]

export interface WeeklyRuleSeed {
  courseSlug: string
  title: string
  /** ISO weekdays: 1 = Mon … 7 = Sun. */
  byWeekday: number[]
  startTime: string
  durationMins: number
}

/**
 * Standing weekday timetable:
 *   "Weekday regular IFDA sessions — every Tuesdays & Wednesdays: 10am–1pm, 2:30–5pm, 7–9:30pm.
 *    Every Thursday: 7–9:30pm."
 */
export const WEEKLY_RULES: WeeklyRuleSeed[] = [
  { courseSlug: 'ifda', title: 'IFDA Morning', byWeekday: [2, 3], startTime: '10:00', durationMins: DURATIONS.morning3h },
  { courseSlug: 'ifda', title: 'IFDA Afternoon', byWeekday: [2, 3], startTime: '14:30', durationMins: DURATIONS.afternoon2h30 },
  { courseSlug: 'ifda', title: 'IFDA Evening', byWeekday: [2, 3], startTime: '19:00', durationMins: DURATIONS.evening2h30 },
  { courseSlug: 'ifda', title: 'IFDA Evening', byWeekday: [4], startTime: '19:00', durationMins: DURATIONS.evening2h30 },
]

export interface OneOffSeed {
  courseSlug: string
  date: DateKey
  startTime: string
  durationMins: number
  title: string
  breaks?: { start: string; end: string; label: string }[]
  notes?: string
}

const ifdaWeekendPair = (date: DateKey, title = 'IFDA Weekend'): OneOffSeed[] => [
  { courseSlug: 'ifda', date, startTime: '10:00', durationMins: DURATIONS.morning3h, title: `${title} — Morning` },
  { courseSlug: 'ifda', date, startTime: '14:30', durationMins: DURATIONS.afternoon2h30, title: `${title} — Afternoon` },
]

const ikebanaWorkshopPair = (date: DateKey): OneOffSeed[] => [
  { courseSlug: 'ikebana', date, startTime: '10:00', durationMins: DURATIONS.ikebanaMorning2h30, title: 'Ikebana Workshop — Morning' },
  { courseSlug: 'ikebana', date, startTime: '14:30', durationMins: DURATIONS.afternoon2h30, title: 'Ikebana Workshop — Afternoon' },
]

/** The four mornings that make up the "Autumn Ikebana Course" product already in the shop. */
const autumnCourseMorning = (date: DateKey, dayNumber: number): OneOffSeed => ({
  courseSlug: 'ikebana',
  date,
  startTime: '10:00',
  durationMins: DURATIONS.ikebanaMorning2h30,
  title: `Autumn Ikebana Course — Day ${dayNumber}`,
  notes: 'Part of the four-session Autumn Ikebana Course (12 & 26 Sep, 10 & 24 Oct).',
})

export const ONE_OFF_SESSIONS: OneOffSeed[] = [
  // August — "Aug 15&16 IFDA Trial and regular class"
  ...ifdaWeekendPair('2026-08-15', 'IFDA Trial & Regular'),
  ...ifdaWeekendPair('2026-08-16', 'IFDA Trial & Regular'),

  // "Aug 22-23 ikebana workshop — 10am-12:30pm, 2:30-5pm"
  ...ikebanaWorkshopPair('2026-08-22'),
  ...ikebanaWorkshopPair('2026-08-23'),

  // "Aug 29-30 bouquet course — 10am-5pm, lunch hour 1-2:30pm"
  {
    courseSlug: 'bouquet',
    date: '2026-08-29',
    startTime: '10:00',
    durationMins: DURATIONS.bouquetFullDay,
    title: 'Bouquet Course — Full Day',
    breaks: LUNCH_BREAK,
  },
  {
    courseSlug: 'bouquet',
    date: '2026-08-30',
    startTime: '10:00',
    durationMins: DURATIONS.bouquetFullDay,
    title: 'Bouquet Course — Full Day',
    breaks: LUNCH_BREAK,
  },

  // September — "Sep IFDA weekend 5-6, 20 — 2 sessions as usual"
  ...ifdaWeekendPair('2026-09-05'),
  ...ifdaWeekendPair('2026-09-06'),
  ...ifdaWeekendPair('2026-09-20'),

  // "Sep ikebana workshop: 12 - morning session, 13 - 2 sessions as usual, 26 - morning session"
  autumnCourseMorning('2026-09-12', 1),
  ...ikebanaWorkshopPair('2026-09-13'),
  autumnCourseMorning('2026-09-26', 2),

  // October — "Oct ikebana workshop: 10 - morning, 11 - 2 sessions, 24 - morning, 25 - 2 sessions"
  autumnCourseMorning('2026-10-10', 3),
  ...ikebanaWorkshopPair('2026-10-11'),
  autumnCourseMorning('2026-10-24', 4),
  ...ikebanaWorkshopPair('2026-10-25'),

  // "Oct IFDA weekend sessions: 17-18, 31 - 1 Nov — 2 sessions as usual"
  ...ifdaWeekendPair('2026-10-17'),
  ...ifdaWeekendPair('2026-10-18'),
  ...ifdaWeekendPair('2026-10-31'),
  ...ifdaWeekendPair('2026-11-01'),
]

export interface CourseSeed {
  name: string
  slug: string
  colour: string
  bookingMode: 'package' | 'paid' | 'free'
  rescheduleCutoffHours: number
  cancelCutoffHours: number
  defaultDurationMins: number
  sortOrder: number
  description: string
}

/**
 * Reschedule policy, straight from the brief:
 *   "Preserved Flower and IFDA students can reschedule freely up to 24 hours before.
 *    Fresh Flower and Ikebana students cannot reschedule within 3 days."
 */
export const COURSES: CourseSeed[] = [
  {
    name: 'IFDA',
    slug: 'ifda',
    colour: '#8b5cf6',
    bookingMode: 'package',
    rescheduleCutoffHours: 24,
    cancelCutoffHours: 24,
    defaultDurationMins: DURATIONS.morning3h,
    sortOrder: 1,
    description: 'Official Korean-style floral design certification course, booked against a course package.',
  },
  {
    name: 'Preserved Flower',
    slug: 'preserved-flower',
    colour: '#ec4899',
    bookingMode: 'package',
    rescheduleCutoffHours: 24,
    cancelCutoffHours: 24,
    defaultDurationMins: DURATIONS.afternoon2h30,
    sortOrder: 2,
    description: 'Preserved flower design course, booked against a course package.',
  },
  {
    name: 'Ikebana',
    slug: 'ikebana',
    colour: '#10b981',
    bookingMode: 'paid',
    rescheduleCutoffHours: 72,
    cancelCutoffHours: 72,
    defaultDurationMins: DURATIONS.ikebanaMorning2h30,
    sortOrder: 3,
    description: 'Ikenobo-style Japanese flower arrangement workshops, held twice monthly.',
  },
  {
    name: 'Fresh Flower',
    slug: 'fresh-flower',
    colour: '#f59e0b',
    bookingMode: 'paid',
    rescheduleCutoffHours: 72,
    cancelCutoffHours: 72,
    defaultDurationMins: DURATIONS.afternoon2h30,
    sortOrder: 4,
    description: 'Fresh flower arrangement workshops.',
  },
  {
    name: 'Bouquet',
    slug: 'bouquet',
    colour: '#ef4444',
    bookingMode: 'paid',
    rescheduleCutoffHours: 72,
    cancelCutoffHours: 72,
    defaultDurationMins: DURATIONS.bouquetFullDay,
    sortOrder: 5,
    description: 'Beginner Course – Bouquet Series, a full-day class with a lunch break.',
  },
]
