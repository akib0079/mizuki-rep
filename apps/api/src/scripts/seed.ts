import { studioInstant } from '@mizuki/shared'
import { connectDb, disconnectDb } from '../db.js'
import { logger } from '../logger.js'
import { CourseTypeModel, ScheduleRuleModel, SessionModel } from '../models/index.js'
import { materializeSessions } from '../services/scheduleService.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'
import { COURSES, ONE_OFF_SESSIONS, PLACEHOLDER_CAPACITY, WEEKLY_RULES } from './timetable.js'

/**
 * Loads the studio's real timetable.
 *
 * Safe to run repeatedly: courses upsert by slug, rules and one-off classes are matched before
 * they are created, and session generation is idempotent. Re-running after the client confirms
 * their class sizes will update the courses without disturbing anything already booked.
 */

/** Weekday rules start generating from the day the system goes live. */
const RULES_EFFECTIVE_FROM = '2026-08-11'

async function seedCourses(): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>()

  for (const course of COURSES) {
    const doc = await CourseTypeModel.findOneAndUpdate(
      { slug: course.slug },
      {
        $set: {
          name: course.name,
          colour: course.colour,
          bookingMode: course.bookingMode,
          rescheduleCutoffHours: course.rescheduleCutoffHours,
          cancelCutoffHours: course.cancelCutoffHours,
          defaultDurationMins: course.defaultDurationMins,
          description: course.description,
          sortOrder: course.sortOrder,
          active: true,
        },
        // Only applied on insert, so a class size the studio has since corrected is never clobbered.
        $setOnInsert: { defaultCapacity: PLACEHOLDER_CAPACITY, wooProductIds: [] },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    bySlug.set(course.slug, String(doc._id))
  }

  logger.info({ count: bySlug.size }, 'Courses seeded')
  return bySlug
}

async function seedWeeklyRules(courseIds: Map<string, string>): Promise<number> {
  let created = 0

  for (const rule of WEEKLY_RULES) {
    const courseTypeId = courseIds.get(rule.courseSlug)
    if (!courseTypeId) throw new Error(`Unknown course slug in WEEKLY_RULES: ${rule.courseSlug}`)

    const existing = await ScheduleRuleModel.findOne({
      courseTypeId,
      startTime: rule.startTime,
      'recurrence.byWeekday': rule.byWeekday,
    })
    if (existing) continue

    await ScheduleRuleModel.create({
      courseTypeId,
      title: rule.title,
      recurrence: { freq: 'WEEKLY', byWeekday: rule.byWeekday, interval: 1 },
      startTime: rule.startTime,
      durationMins: rule.durationMins,
      capacity: PLACEHOLDER_CAPACITY,
      breaks: [],
      effectiveFrom: RULES_EFFECTIVE_FROM,
      effectiveTo: null,
      active: true,
    })
    created++
  }

  logger.info({ created, total: WEEKLY_RULES.length }, 'Weekly schedule rules seeded')
  return created
}

async function seedOneOffSessions(courseIds: Map<string, string>): Promise<number> {
  let created = 0

  for (const seed of ONE_OFF_SESSIONS) {
    const courseTypeId = courseIds.get(seed.courseSlug)
    if (!courseTypeId) throw new Error(`Unknown course slug in ONE_OFF_SESSIONS: ${seed.courseSlug}`)

    const startAt = studioInstant(seed.date, seed.startTime)

    // Match on rule-less classes only, so a weekend one-off is never confused with a
    // generated weekday class that happens to share a start time.
    const existing = await SessionModel.findOne({ courseTypeId, startAt, scheduleRuleId: null })
    if (existing) continue

    await SessionModel.create({
      courseTypeId,
      scheduleRuleId: null,
      startAt,
      endAt: new Date(startAt.getTime() + seed.durationMins * 60_000),
      dateKey: seed.date,
      capacity: PLACEHOLDER_CAPACITY,
      heldBack: 0,
      seatsTaken: 0,
      breaks: seed.breaks ?? [],
      status: 'scheduled',
      title: seed.title,
      notes: seed.notes ?? '',
    })
    created++
  }

  logger.info({ created, total: ONE_OFF_SESSIONS.length }, 'Weekend and workshop sessions seeded')
  return created
}

export async function runSeed(): Promise<void> {
  const courseIds = await seedCourses()
  await seedWeeklyRules(courseIds)
  await seedOneOffSessions(courseIds)
  await seedEmailTemplates()

  // Generate the weekday classes from the rules, out to the end of the calendar window.
  const result = await materializeSessions()

  const total = await SessionModel.countDocuments({ status: 'scheduled' })
  logger.info({ generated: result.created, totalScheduled: total }, 'Seed complete')
}

const isEntrypoint = process.argv[1]?.includes('seed')

if (isEntrypoint) {
  connectDb()
    .then(runSeed)
    .then(() => disconnectDb())
    .then(() => {
      logger.info('Done. Remember to set real class sizes — every seeded session uses a placeholder capacity.')
      process.exit(0)
    })
    .catch((err) => {
      logger.error({ err }, 'Seed failed')
      process.exit(1)
    })
}
