import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { STUDIO_TZ, formatTimeRange } from '@mizuki/shared'
import { ClosedDateModel, CourseTypeModel, ScheduleRuleModel, SessionModel } from '../models/index.js'
import { materializeSessions } from '../services/scheduleService.js'
import { runSeed } from './seed.js'
import { ONE_OFF_SESSIONS } from './timetable.js'

/**
 * These assert that the timetable the client wrote out in prose comes back out of the database
 * unchanged. They are the check that a wrong weekday or a dropped session gets caught here
 * rather than by a student turning up on the wrong day.
 */

/** Every scheduled class on a studio-local day, as "HH:mm–HH:mm" strings in time order. */
async function timesOn(dateKey: string): Promise<string[]> {
  const sessions = await SessionModel.find({ dateKey, status: 'scheduled' }).sort({ startAt: 1 }).lean()
  return sessions.map((s) =>
    [
      DateTime.fromJSDate(s.startAt).setZone(STUDIO_TZ).toFormat('HH:mm'),
      DateTime.fromJSDate(s.endAt).setZone(STUDIO_TZ).toFormat('HH:mm'),
    ].join('–'),
  )
}

async function courseOn(dateKey: string): Promise<string[]> {
  const sessions = await SessionModel.find({ dateKey, status: 'scheduled' })
    .sort({ startAt: 1 })
    .populate<{ courseTypeId: { name: string } }>('courseTypeId', 'name')
    .lean()
  return sessions.map((s) => s.courseTypeId.name)
}

describe('seeded timetable', () => {
  it('creates the five courses with the reschedule rules from the brief', async () => {
    await runSeed()

    const courses = await CourseTypeModel.find().sort({ sortOrder: 1 }).lean()
    expect(courses.map((c) => c.slug)).toEqual([
      'ifda',
      'preserved-flower',
      'ikebana',
      'fresh-flower',
      'bouquet',
    ])

    const bySlug = Object.fromEntries(courses.map((c) => [c.slug, c]))

    // "Preserved Flower and IFDA students can reschedule freely up to 24 hours before."
    expect(bySlug['ifda']!.rescheduleCutoffHours).toBe(24)
    expect(bySlug['preserved-flower']!.rescheduleCutoffHours).toBe(24)
    // "Fresh Flower and Ikebana students cannot reschedule within 3 days."
    expect(bySlug['ikebana']!.rescheduleCutoffHours).toBe(72)
    expect(bySlug['fresh-flower']!.rescheduleCutoffHours).toBe(72)

    // Course packages are counted down for IFDA and Preserved Flower only.
    expect(bySlug['ifda']!.bookingMode).toBe('package')
    expect(bySlug['preserved-flower']!.bookingMode).toBe('package')
    expect(bySlug['ikebana']!.bookingMode).toBe('paid')
  })

  it('runs the weekday IFDA timetable on Tuesdays, Wednesdays and Thursdays', async () => {
    await runSeed()
    // Generate a specific week so the assertions do not depend on today's date.
    await materializeSessions({ from: '2026-09-01', to: '2026-09-30' })

    // "Every Tuesdays & Wednesdays — Morning 10am-1pm, Afternoon 2:30-5pm, Night 7-9:30pm"
    expect(await timesOn('2026-09-08')).toEqual(['10:00–13:00', '14:30–17:00', '19:00–21:30']) // Tue
    expect(await timesOn('2026-09-09')).toEqual(['10:00–13:00', '14:30–17:00', '19:00–21:30']) // Wed

    // "Every Thursday — 7-9:30pm"
    expect(await timesOn('2026-09-10')).toEqual(['19:00–21:30']) // Thu

    // Mondays and Fridays are not teaching days.
    expect(await timesOn('2026-09-07')).toEqual([]) // Mon
    expect(await timesOn('2026-09-11')).toEqual([]) // Fri

    expect(await courseOn('2026-09-08')).toEqual(['IFDA', 'IFDA', 'IFDA'])
  })

  it('places the August weekend workshops exactly as described', async () => {
    await runSeed()

    // "Aug 15&16 IFDA Trial and regular class — Morning 10am-1pm, Afternoon 2:30-5pm"
    expect(await timesOn('2026-08-15')).toEqual(['10:00–13:00', '14:30–17:00'])
    expect(await courseOn('2026-08-15')).toEqual(['IFDA', 'IFDA'])
    expect(await timesOn('2026-08-16')).toEqual(['10:00–13:00', '14:30–17:00'])

    // "Aug 22-23 ikebana workshop — Morning 10am-12:30pm, Afternoon 2:30-5pm"
    expect(await timesOn('2026-08-22')).toEqual(['10:00–12:30', '14:30–17:00'])
    expect(await courseOn('2026-08-22')).toEqual(['Ikebana', 'Ikebana'])
    expect(await timesOn('2026-08-23')).toEqual(['10:00–12:30', '14:30–17:00'])

    // "Aug 29-30 bouquet course — 10am-5pm, Lunch hour 1-2:30pm"
    expect(await timesOn('2026-08-29')).toEqual(['10:00–17:00'])
    expect(await courseOn('2026-08-29')).toEqual(['Bouquet'])

    const bouquet = await SessionModel.findOne({ dateKey: '2026-08-29' }).lean()
    expect(bouquet!.breaks).toEqual([{ start: '13:00', end: '14:30', label: 'Lunch' }])
  })

  it('splits the September and October Ikebana dates into course mornings and full workshop days', async () => {
    await runSeed()

    // "12 - morning session, 13 - 2 sessions as usual, 26 - morning session"
    expect(await timesOn('2026-09-12')).toEqual(['10:00–12:30'])
    expect(await timesOn('2026-09-13')).toEqual(['10:00–12:30', '14:30–17:00'])
    expect(await timesOn('2026-09-26')).toEqual(['10:00–12:30'])

    // "10 - morning session, 11 - 2 sessions, 24 - morning session, 25 - 2 sessions"
    expect(await timesOn('2026-10-10')).toEqual(['10:00–12:30'])
    expect(await timesOn('2026-10-11')).toEqual(['10:00–12:30', '14:30–17:00'])
    expect(await timesOn('2026-10-24')).toEqual(['10:00–12:30'])
    expect(await timesOn('2026-10-25')).toEqual(['10:00–12:30', '14:30–17:00'])

    // The four course mornings match the "Autumn Ikebana Course" product already in the shop.
    const autumn = await SessionModel.find({ title: /Autumn Ikebana Course/ }).sort({ startAt: 1 }).lean()
    expect(autumn.map((s) => s.dateKey)).toEqual(['2026-09-12', '2026-09-26', '2026-10-10', '2026-10-24'])
  })

  it('places the IFDA weekends including the one that straddles into November', async () => {
    await runSeed()

    for (const date of ['2026-09-05', '2026-09-06', '2026-09-20', '2026-10-17', '2026-10-18']) {
      expect(await timesOn(date), date).toEqual(['10:00–13:00', '14:30–17:00'])
    }

    // "31 - 1 Nov" — a weekend that crosses the month boundary.
    expect(await timesOn('2026-10-31')).toEqual(['10:00–13:00', '14:30–17:00'])
    expect(await timesOn('2026-11-01')).toEqual(['10:00–13:00', '14:30–17:00'])
  })

  it('puts every weekend session on an actual weekend', async () => {
    // Guards against a transcription slip in the timetable — a "weekend session" landing midweek.
    const weekdayNames = ONE_OFF_SESSIONS.map((s) => ({
      date: s.date,
      weekday: DateTime.fromFormat(s.date, 'yyyy-MM-dd', { zone: STUDIO_TZ }).weekday,
      title: s.title,
    }))

    const midweek = weekdayNames.filter((s) => s.weekday < 6)
    expect(midweek).toEqual([])
  })

  it('is safe to run twice', async () => {
    await runSeed()
    const firstCount = await SessionModel.countDocuments()
    const firstCourses = await CourseTypeModel.countDocuments()
    const firstRules = await ScheduleRuleModel.countDocuments()

    await runSeed()

    expect(await SessionModel.countDocuments()).toBe(firstCount)
    expect(await CourseTypeModel.countDocuments()).toBe(firstCourses)
    expect(await ScheduleRuleModel.countDocuments()).toBe(firstRules)
  })

  it('keeps a class size the studio has corrected when the seed is re-run', async () => {
    await runSeed()
    await CourseTypeModel.updateOne({ slug: 'ikebana' }, { $set: { defaultCapacity: 6 } })

    await runSeed()

    const ikebana = await CourseTypeModel.findOne({ slug: 'ikebana' }).lean()
    expect(ikebana!.defaultCapacity).toBe(6)
  })
})

describe('generation and closed dates', () => {
  it('does not generate weekday classes on days the studio is already closed', async () => {
    await runSeed()
    await SessionModel.deleteMany({ scheduleRuleId: { $ne: null } })

    // The teacher is away for outside work for a week.
    await ClosedDateModel.create({ startDate: '2026-09-07', endDate: '2026-09-13', reason: 'Away — outside work' })

    const result = await materializeSessions({ from: '2026-09-01', to: '2026-09-30' })

    expect(await timesOn('2026-09-08')).toEqual([]) // Tue inside the closed week
    expect(await timesOn('2026-09-10')).toEqual([]) // Thu inside the closed week
    expect(await timesOn('2026-09-15')).toEqual(['10:00–13:00', '14:30–17:00', '19:00–21:30']) // Tue after
    expect(result.skippedClosed).toBeGreaterThan(0)
  })

  it('generates nothing new on a second pass over the same window', async () => {
    await runSeed()
    const before = await SessionModel.countDocuments()

    const result = await materializeSessions({ from: '2026-09-01', to: '2026-09-30' })
    const second = await materializeSessions({ from: '2026-09-01', to: '2026-09-30' })

    expect(second.created).toBe(0)
    expect(second.skippedExisting).toBeGreaterThan(0)
    expect(await SessionModel.countDocuments()).toBe(before + result.created)
  })

  it('formats a seeded class the way the widget and emails will show it', async () => {
    await runSeed()
    const session = await SessionModel.findOne({ dateKey: '2026-08-22' }).sort({ startAt: 1 }).lean()
    expect(formatTimeRange(session!.startAt, session!.endAt)).toBe('10:00 AM – 12:30 PM')
  })
})
