import { DateTime } from 'luxon'
import { STUDIO_TZ, type DateKey } from '@mizuki/shared'
import { ClosedDateModel } from '../models/index.js'

/**
 * Closed days are stored as inclusive `YYYY-MM-DD` ranges in the studio's own calendar,
 * so "closed on the 20th" covers the whole of the 20th in Singapore — not a 24-hour window
 * that starts at 8am because the server thinks in UTC.
 */

export async function loadClosedDateKeys(from: DateKey, to: DateKey): Promise<Set<DateKey>> {
  // Any stored range that overlaps the window. Lexicographic comparison is safe on
  // zero-padded ISO dates, which is why they are stored as strings.
  const ranges = await ClosedDateModel.find({ startDate: { $lte: to }, endDate: { $gte: from } })
    .select('startDate endDate')
    .lean()

  const keys = new Set<DateKey>()
  for (const range of ranges) {
    let cursor = DateTime.fromFormat(range.startDate, 'yyyy-MM-dd', { zone: STUDIO_TZ })
    const end = DateTime.fromFormat(range.endDate, 'yyyy-MM-dd', { zone: STUDIO_TZ })
    while (cursor <= end) {
      const key = cursor.toFormat('yyyy-MM-dd')
      if (key >= from && key <= to) keys.add(key)
      cursor = cursor.plus({ days: 1 })
    }
  }
  return keys
}

export async function isClosed(dateKey: DateKey): Promise<boolean> {
  const hit = await ClosedDateModel.exists({ startDate: { $lte: dateKey }, endDate: { $gte: dateKey } })
  return hit !== null
}
