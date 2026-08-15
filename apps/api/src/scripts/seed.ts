import { studioInstant } from '@mizuki/shared'
import { connectDb, disconnectDb } from '../db.js'
import { logger } from '../logger.js'
import { CourseSeriesModel, CourseTypeModel, ScheduleRuleModel, SessionModel } from '../models/index.js'
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
        // Only applied on insert, so a class size the studio has since corrected is never
        // clobbered — and neither is a course they have since moved out of its own section.
        $setOnInsert: {
          defaultCapacity: PLACEHOLDER_CAPACITY,
          wooProductIds: [],
          managedSeparately: course.managedSeparately ?? false,
        },
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

/**
 * The "Autumn Ikebana Course" already in the shop — four consecutive mornings sold as one
 * thing. Built from the sessions seeded above rather than duplicating those dates, so moving
 * one of them on the calendar keeps the course pointing at the right class.
 */
async function seedAutumnIkebanaCourse(courseIds: Map<string, string>): Promise<void> {
  const courseTypeId = courseIds.get('ikebana')
  if (!courseTypeId) return

  const sessions = await SessionModel.find({ title: /Autumn Ikebana Course/ }).sort({ startAt: 1 })
  if (sessions.length === 0) return

  const existing = await CourseSeriesModel.findOne({ name: 'Autumn Ikebana Course' })
  if (existing) {
    // Keep the dates in step if the seed runs again, but leave the shop product id alone —
    // the studio sets that by hand once they know it.
    existing.set('sessionIds', sessions.map((s) => s._id))
    await existing.save()
    return
  }

  await CourseSeriesModel.create({
    name: 'Autumn Ikebana Course',
    courseTypeId,
    sessionIds: sessions.map((s) => s._id),
    description:
      'A four-session beginner course in the Ikenobo style, across four mornings — 12 and 26 September, 10 and 24 October. One booking covers all four dates.',
    active: true,
  })

  logger.info({ sessions: sessions.length }, 'Autumn Ikebana Course seeded')
}

export async function runSeed(): Promise<void> {
  const courseIds = await seedCourses()
  await seedWeeklyRules(courseIds)
  await seedOneOffSessions(courseIds)
  await seedAutumnIkebanaCourse(courseIds)
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
