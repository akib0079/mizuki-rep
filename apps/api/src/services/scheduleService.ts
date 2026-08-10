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
      const exists = await SessionModel.exists({ scheduleRuleId: rule._id, dateKey, startAt })
      if (exists) {
        skippedExisting++
        continue
      }

      await SessionModel.create({
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
      created++
    }
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
