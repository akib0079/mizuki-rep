import { DateTime } from 'luxon'
import { Types } from 'mongoose'
import { STUDIO_TZ, eachDateKey, studioInstant, weekdayOf, type DateKey } from '@mizuki/shared'
import { ScheduleRuleModel, SessionModel, type ScheduleRuleDoc } from '../models/index.js'
import { loadClosedDateKeys } from './closedDateService.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Turns the weekly timetable into concrete classes.
 *
 * The studio's schedule is mostly repetition — IFDA every Tuesday, Wednesday and Thursday —
 * with weekend workshops dropped on top. Rules describe the repetition; this generator walks
 * the next few months and creates the Sessions that students actually book.
 *
 * It is run from cron, so it must be safe to run again and again: generating twice must not
 * double the classes, and it must never touch a class the studio has edited by hand.
 */

export interface MaterializeResult {
  created: number
  skippedExisting: number
  skippedClosed: number
  from: DateKey
  to: DateKey
}

/** Does this rule fire on this studio-local day? */
export function ruleFiresOn(rule: Pick<ScheduleRuleDoc, 'recurrence' | 'effectiveFrom' | 'effectiveTo'>, dateKey: DateKey): boolean {
  if (dateKey < rule.effectiveFrom) return false
  if (rule.effectiveTo && dateKey > rule.effectiveTo) return false

  if (rule.recurrence.freq === 'NONE') {
    return dateKey === rule.effectiveFrom
  }

  if (!rule.recurrence.byWeekday.includes(weekdayOf(dateKey))) return false

  const interval = rule.recurrence.interval ?? 1
  if (interval <= 1) return true

  // Fortnightly and beyond are anchored to the rule's first week, so "every other Tuesday"
  // stays on the same alternating weeks however far ahead we generate.
  const anchor = DateTime.fromFormat(rule.effectiveFrom, 'yyyy-MM-dd', { zone: STUDIO_TZ }).startOf('week')
  const target = DateTime.fromFormat(dateKey, 'yyyy-MM-dd', { zone: STUDIO_TZ }).startOf('week')
  const weeksApart = Math.round(target.diff(anchor, 'weeks').weeks)
  return weeksApart % interval === 0
}

export function defaultWindow(now: Date = new Date()): { from: DateKey; to: DateKey } {
  const start = DateTime.fromJSDate(now).setZone(STUDIO_TZ).startOf('day')
  return {
    from: start.toFormat('yyyy-MM-dd'),
    to: start.plus({ months: config.CALENDAR_MONTHS_AHEAD }).endOf('month').toFormat('yyyy-MM-dd'),
  }
}

/**
 * Generate every missing class from the active rules across a window.
 *
 * Idempotency comes from a per-(rule, day, start time) existence check rather than from
 * deleting and rebuilding: a class carries bookings, and rebuilding would throw them away.
 */
export async function materializeSessions(opts: { from?: DateKey; to?: DateKey; now?: Date } = {}): Promise<MaterializeResult> {
  const window = defaultWindow(opts.now)
  const from = opts.from ?? window.from
  const to = opts.to ?? window.to

  const [rules, closedKeys] = await Promise.all([
    ScheduleRuleModel.find({
      active: true,
      effectiveFrom: { $lte: to },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
    }).lean(),
    loadClosedDateKeys(from, to),
  ])

  const dateKeys = eachDateKey(from, to)
  let created = 0
  let skippedExisting = 0
  let skippedClosed = 0

  /*
   * Every already-generated class in the window, fetched once.
   *
   * This used to ask the database "does this one exist?" per rule per day — around 440 queries
   * for a three-month window. Against a database on the same machine that is free; against
   * Atlas it is 440 round trips to Singapore, and the scheduled tick took 27 seconds to decide
   * it had nothing to do. One query and a Set does the same work in one round trip.
   */
  const existing = await SessionModel.find({
    scheduleRuleId: { $in: rules.map((r) => r._id) },
    dateKey: { $gte: from, $lte: to },
  })
    .select('scheduleRuleId startAt')
    .lean()

  const seen = new Set(existing.map((s) => `${String(s.scheduleRuleId)}|${s.startAt.getTime()}`))

  /*
   * Slots the studio has deleted. Treated exactly like an existing session — the generator's
   * question is "is this slot already accounted for", and a deliberately removed one is.
   * Without this a deleted weekly class comes back on the next tick, five minutes later, with
   * nothing on screen to explain it.
   */
  for (const rule of rules) {
    for (const at of rule.exceptions ?? []) {
      seen.add(`${String(rule._id)}|${new Date(at).getTime()}`)
    }
  }

  const pending: Record<string, unknown>[] = []

  for (const rule of rules) {
    for (const dateKey of dateKeys) {
      if (!ruleFiresOn(rule as unknown as ScheduleRuleDoc, dateKey)) continue

      // Don't create classes on days the studio has already said it is shut. Days closed
      // *after* generation are handled by the calendar filter instead, so that existing
      // bookings stay visible to the admin rather than disappearing.
      if (closedKeys.has(dateKey)) {
        skippedClosed++
        continue
      }

      const startAt = studioInstant(dateKey, rule.startTime)
      if (seen.has(`${String(rule._id)}|${startAt.getTime()}`)) {
        skippedExisting++
        continue
      }

      pending.push({
        courseTypeId: rule.courseTypeId,
        scheduleRuleId: rule._id,
        startAt,
        endAt: new Date(startAt.getTime() + rule.durationMins * 60_000),
        dateKey,
        capacity: rule.capacity,
        heldBack: 0,
        seatsTaken: 0,
        breaks: rule.breaks ?? [],
        status: 'scheduled',
        title: rule.title,
      })
      // Guards against a rule that somehow fires twice for the same instant within one pass.
      seen.add(`${String(rule._id)}|${startAt.getTime()}`)
    }
  }

  // One insert rather than one per class — the same round-trip argument as the lookup above.
  if (pending.length > 0) {
    await SessionModel.insertMany(pending)
    created = pending.length
  }

  logger.info({ from, to, created, skippedExisting, skippedClosed }, 'Materialized sessions')
  return { created, skippedExisting, skippedClosed, from, to }
}

/**
 * Create a one-off class that no rule owns — a weekend workshop, or a make-up session.
 * `scheduleRuleId` stays null so regeneration never touches it.
 */
export async function createAdHocSession(input: {
  courseTypeId: Types.ObjectId | string
  dateKey: DateKey
  startTime: string
  durationMins: number
  capacity: number
  title?: string
  notes?: string
  breaks?: { start: string; end: string; label: string }[]
}) {
  const startAt = studioInstant(input.dateKey, input.startTime)
  return SessionModel.create({
    courseTypeId: input.courseTypeId,
    scheduleRuleId: null,
    startAt,
    endAt: new Date(startAt.getTime() + input.durationMins * 60_000),
    dateKey: input.dateKey,
    capacity: input.capacity,
    heldBack: 0,
    seatsTaken: 0,
    breaks: input.breaks ?? [],
    status: 'scheduled',
    title: input.title ?? '',
    notes: input.notes ?? '',
  })
}
