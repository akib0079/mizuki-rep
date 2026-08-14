import { DateTime } from 'luxon'
import { Types } from 'mongoose'
import {
  STUDIO_TZ,
  eachDateKey,
  isSessionFull,
  seatsLeft,
  sessionAvailability,
  studioInstant,
  type DateKey,
  type PublicCalendarDay,
  type PublicSession,
} from '@mizuki/shared'
import { CourseTypeModel, SessionModel, type CourseTypeDoc } from '../models/index.js'
import { loadClosedDateKeys } from './closedDateService.js'
import { config } from '../config.js'

/**
 * The student-facing calendar: "Students see the next 3 months of classes on your site.
 * They click a date, see every session that day with the time, length and places left."
 *
 * Every day in the window is returned, including empty and closed ones, so the widget can
 * render a complete month grid without inventing the gaps.
 */

export function defaultCalendarWindow(now: Date = new Date()): { from: DateKey; to: DateKey } {
  const today = DateTime.fromJSDate(now).setZone(STUDIO_TZ).startOf('day')
  return {
    from: today.toFormat('yyyy-MM-dd'),
    to: today.plus({ months: config.CALENDAR_MONTHS_AHEAD }).endOf('month').toFormat('yyyy-MM-dd'),
  }
}

export interface CalendarOptions {
  from?: DateKey
  to?: DateKey
  courseTypeId?: string
  now?: Date
}

export async function buildPublicCalendar(opts: CalendarOptions = {}): Promise<{
  from: DateKey
  to: DateKey
  days: PublicCalendarDay[]
}> {
  const now = opts.now ?? new Date()
  const window = defaultCalendarWindow(now)
  const from = opts.from ?? window.from
  // Never let a caller read further ahead than the studio has planned.
  const to = opts.to && opts.to <= window.to ? opts.to : window.to

  const query: Record<string, unknown> = {
    status: 'scheduled',
    dateKey: { $gte: from, $lte: to },
    // A class that has already started is history, not something to book.
    startAt: { $gte: now },
  }
  if (opts.courseTypeId) query.courseTypeId = new Types.ObjectId(opts.courseTypeId)

  const [sessions, closedKeys, courses] = await Promise.all([
    SessionModel.find(query).sort({ startAt: 1 }).lean(),
    loadClosedDateKeys(from, to),
    CourseTypeModel.find({ active: true }).lean(),
  ])

  const courseById = new Map(courses.map((c) => [String(c._id), c]))

  const byDate = new Map<DateKey, PublicSession[]>()
  for (const session of sessions) {
    const course = courseById.get(String(session.courseTypeId))
    // Skip classes whose course has been deactivated — they are no longer on offer.
    if (!course) continue

    const list = byDate.get(session.dateKey) ?? []
    list.push(toPublicSession(session, course))
    byDate.set(session.dateKey, list)
  }

  const days: PublicCalendarDay[] = eachDateKey(from, to).map((date) => {
    const isClosed = closedKeys.has(date)
    return {
      date,
      isClosed,
      // Closed days show as closed with nothing on them — "mark the days you're closed and
      // they disappear from the calendar instantly", including classes already generated there.
      sessions: isClosed ? [] : (byDate.get(date) ?? []),
    }
  })

  return { from, to, days }
}

export function toPublicSession(
  session: {
    _id: Types.ObjectId
    courseTypeId: Types.ObjectId
    startAt: Date
    endAt: Date
    capacity: number
    heldBack: number
    seatsTaken: number
    breaks: { start: string; end: string; label: string }[]
    title: string
  },
  course: Pick<CourseTypeDoc, 'name' | 'colour' | 'bookingMode'>,
): PublicSession {
  const durationMins = Math.round((session.endAt.getTime() - session.startAt.getTime()) / 60_000)
  return {
    id: String(session._id),
    courseTypeId: String(session.courseTypeId),
    courseName: course.name,
    colour: course.colour,
    title: session.title || course.name,
    startAt: session.startAt.toISOString(),
    endAt: session.endAt.toISOString(),
    durationMins,
    breaks: session.breaks ?? [],
    seatsLeft: seatsLeft(session),
    isFull: isSessionFull(session),
    availability: sessionAvailability(session),
    bookingMode: course.bookingMode,
  }
}

/** Alternative classes to offer a student who is moving, or whose class was cancelled. */
export async function findAlternatives(
  courseTypeId: Types.ObjectId | string,
  opts: { excludeSessionId?: Types.ObjectId | string; limit?: number; now?: Date } = {},
): Promise<PublicSession[]> {
  const now = opts.now ?? new Date()
  const window = defaultCalendarWindow(now)

  const course = await CourseTypeModel.findById(courseTypeId).lean()
  if (!course) return []

  const query: Record<string, unknown> = {
    courseTypeId,
    status: 'scheduled',
    startAt: { $gte: now },
    dateKey: { $lte: window.to },
  }
  if (opts.excludeSessionId) query._id = { $ne: opts.excludeSessionId }

  const sessions = await SessionModel.find(query).sort({ startAt: 1 }).limit(200).lean()
  const closedKeys = await loadClosedDateKeys(window.from, window.to)

  return sessions
    .filter((s) => !closedKeys.has(s.dateKey))
    .map((s) => toPublicSession(s, course))
    .filter((s) => !s.isFull)
    .slice(0, opts.limit ?? 30)
}

/** The full picture for one class, for the widget's booking panel. */
export async function getPublicSession(sessionId: Types.ObjectId | string): Promise<PublicSession | null> {
  const session = await SessionModel.findById(sessionId).lean()
  if (!session || session.status !== 'scheduled') return null

  const course = await CourseTypeModel.findById(session.courseTypeId).lean()
  if (!course || !course.active) return null

  const closed = await loadClosedDateKeys(session.dateKey, session.dateKey)
  if (closed.has(session.dateKey)) return null

  return toPublicSession(session, course)
}

/** Sanity guard used by the seeder and tests: the window really is three months of days. */
export function windowLengthDays(from: DateKey, to: DateKey): number {
  return eachDateKey(from, to).length
}

export { studioInstant }
