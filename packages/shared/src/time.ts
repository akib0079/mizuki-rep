import { DateTime, Duration } from 'luxon'

/**
 * The studio runs in Singapore, which is UTC+8 year-round with no DST.
 * Everything is stored as UTC in Mongo; every business rule and every string
 * a human reads is computed in this zone. Never format a session time without
 * going through here — a raw `toLocaleString()` renders in the *server's* zone,
 * which on Hostinger is UTC, and would silently shift every class by 8 hours.
 */
export const STUDIO_TZ = 'Asia/Singapore'

/** A calendar day in the studio's zone, as `YYYY-MM-DD`. */
export type DateKey = string

export function toStudio(value: Date | string | DateTime): DateTime {
  if (value instanceof DateTime) return value.setZone(STUDIO_TZ)
  const dt = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value)
  return dt.setZone(STUDIO_TZ)
}

/** The studio-local calendar day an instant falls on. Used for grouping the calendar and matching closed dates. */
export function dateKeyOf(value: Date | string | DateTime): DateKey {
  return toStudio(value).toFormat('yyyy-MM-dd')
}

export function isDateKey(value: string): value is DateKey {
  return DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: STUDIO_TZ }).isValid
}

/**
 * Turn a studio-local day + wall-clock time into a UTC instant.
 * This is how ScheduleRule ("Tuesdays at 10:00") becomes a concrete Session.
 */
export function studioInstant(dateKey: DateKey, time: string): Date {
  const dt = DateTime.fromFormat(`${dateKey} ${time}`, 'yyyy-MM-dd HH:mm', { zone: STUDIO_TZ })
  if (!dt.isValid) throw new Error(`Invalid studio instant: "${dateKey} ${time}" (${dt.invalidReason})`)
  return dt.toUTC().toJSDate()
}

/** Inclusive list of studio-local day keys between two days. */
export function eachDateKey(from: DateKey, to: DateKey): DateKey[] {
  const start = DateTime.fromFormat(from, 'yyyy-MM-dd', { zone: STUDIO_TZ })
  const end = DateTime.fromFormat(to, 'yyyy-MM-dd', { zone: STUDIO_TZ })
  if (!start.isValid || !end.isValid) throw new Error(`Invalid date range: ${from}..${to}`)

  const keys: DateKey[] = []
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    keys.push(cursor.toFormat('yyyy-MM-dd'))
  }
  return keys
}

/** ISO weekday in the studio zone: 1 = Monday … 7 = Sunday (matches Luxon). */
export function weekdayOf(dateKey: DateKey): number {
  return DateTime.fromFormat(dateKey, 'yyyy-MM-dd', { zone: STUDIO_TZ }).weekday
}

export function addMinutes(instant: Date, minutes: number): Date {
  return DateTime.fromJSDate(instant).plus({ minutes }).toJSDate()
}

export function subtractHours(instant: Date, hours: number): Date {
  return DateTime.fromJSDate(instant).minus({ hours }).toJSDate()
}

/** "Sat 15 Aug 2026, 10:00 AM" — the canonical way a date appears in emails and UI. */
export function formatSessionDateTime(instant: Date): string {
  return toStudio(instant).toFormat("ccc d LLL yyyy, h:mm a")
}

/** "10:00 AM – 1:00 PM" */
export function formatTimeRange(startAt: Date, endAt: Date): string {
  return `${toStudio(startAt).toFormat('h:mm a')} – ${toStudio(endAt).toFormat('h:mm a')}`
}

/** "3h", "2h 30m", "45m" — how long the class runs, for the session list. */
export function formatDuration(minutes: number): string {
  const dur = Duration.fromObject({ minutes }).shiftTo('hours', 'minutes')
  const hours = Math.floor(dur.hours)
  const mins = Math.round(dur.minutes)
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

/** "in 3 days", "in 5 hours", "in 20 minutes" — used for reschedule deadline copy. */
export function formatRelativeTo(target: Date, now: Date): string {
  return toStudio(target).toRelative({ base: toStudio(now) }) ?? ''
}
