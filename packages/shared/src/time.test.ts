import { describe, expect, it } from 'vitest'
import {
  dateKeyOf,
  eachDateKey,
  formatDuration,
  formatSessionDateTime,
  formatTimeRange,
  studioInstant,
  weekdayOf,
} from './time.js'

describe('studio time', () => {
  it('converts a studio wall clock to the right UTC instant', () => {
    // Singapore is UTC+8 all year, so 10:00 SGT is 02:00 UTC.
    expect(studioInstant('2026-08-22', '10:00').toISOString()).toBe('2026-08-22T02:00:00.000Z')
  })

  it('keeps a late-evening class on the correct studio day', () => {
    // The Thursday 19:00 IFDA session is 11:00 UTC — same UTC day here, but the
    // day key must come from the studio zone, never from the raw UTC date.
    const thursdayNight = studioInstant('2026-08-20', '19:00')
    expect(dateKeyOf(thursdayNight)).toBe('2026-08-20')
    expect(weekdayOf(dateKeyOf(thursdayNight))).toBe(4)
  })

  it('assigns a UTC-midnight-crossing instant to the studio day, not the UTC day', () => {
    // 2026-08-23T17:30:00Z is 01:30 on 24 Aug in Singapore.
    expect(dateKeyOf(new Date('2026-08-23T17:30:00.000Z'))).toBe('2026-08-24')
  })

  it('maps the seed weekend dates to the weekdays the client described', () => {
    expect(weekdayOf('2026-08-15')).toBe(6) // Sat
    expect(weekdayOf('2026-08-16')).toBe(7) // Sun
    expect(weekdayOf('2026-10-31')).toBe(6) // Sat
    expect(weekdayOf('2026-11-01')).toBe(7) // Sun
  })

  it('walks an inclusive range of studio days', () => {
    expect(eachDateKey('2026-08-29', '2026-09-01')).toEqual([
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ])
  })

  it('rejects a malformed wall clock rather than silently shifting a class', () => {
    expect(() => studioInstant('2026-08-22', '25:00')).toThrow(/Invalid studio instant/)
  })
})

describe('human formatting', () => {
  it('formats a session date the way emails and the widget show it', () => {
    expect(formatSessionDateTime(studioInstant('2026-08-22', '10:00'))).toBe('Sat 22 Aug 2026, 10:00 AM')
  })

  it('formats the time range shown in the day list', () => {
    expect(formatTimeRange(studioInstant('2026-08-22', '10:00'), studioInstant('2026-08-22', '12:30'))).toBe(
      '10:00 AM – 12:30 PM',
    )
  })

  it('formats class lengths', () => {
    expect(formatDuration(180)).toBe('3h')
    expect(formatDuration(150)).toBe('2h 30m')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(420)).toBe('7h')
  })
})
