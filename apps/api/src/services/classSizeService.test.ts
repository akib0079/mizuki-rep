import { describe, expect, it } from 'vitest'
import { AuditLogModel, CourseTypeModel, ScheduleRuleModel, SessionModel } from '../models/index.js'
import { makeCourseType, makeSession } from '../test/factories.js'
import { applyClassSize, planClassSize } from './classSizeService.js'
import { buildDashboard } from './dashboardService.js'

/**
 * The bug these cover: the settings page wrote the class size to the course row only, so the
 * studio could set 12, see it saved, and still have every class on the calendar sized 8 — with
 * the generator lined up to create more of them. A setting that reports success and changes
 * nothing is worse than no setting, so each of the three places is asserted separately.
 */

async function makeRule(courseTypeId: unknown, capacity = 8) {
  return ScheduleRuleModel.create({
    courseTypeId,
    title: 'IFDA Morning',
    recurrence: { freq: 'WEEKLY', byWeekday: [2, 3], interval: 1 },
    startTime: '10:00',
    durationMins: 180,
    capacity,
    effectiveFrom: '2026-08-01',
  })
}

describe('planClassSize', () => {
  it('counts the classes that would change, without changing them', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })
    await makeSession({ courseTypeId: course._id, date: '2026-09-13', capacity: 8 })

    const plan = await planClassSize(course._id, 12, new Date('2026-08-15T00:00:00Z'))

    expect(plan.willChange).toBe(2)
    expect(plan.blocked).toEqual([])

    // Nothing was written.
    const untouched = await SessionModel.find({ courseTypeId: course._id }).lean()
    expect(untouched.every((s) => s.capacity === 8)).toBe(true)
  })

  it('separates classes already at the size from ones that need it', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 12 })
    await makeSession({ courseTypeId: course._id, date: '2026-09-13', capacity: 8 })

    const plan = await planClassSize(course._id, 12, new Date('2026-08-15T00:00:00Z'))

    expect(plan.alreadyCorrect).toBe(1)
    expect(plan.willChange).toBe(1)
  })

  it('leaves a class whose size was set by hand out of the count', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })
    await makeSession({
      courseTypeId: course._id,
      date: '2026-09-13',
      capacity: 4,
      overriddenFields: ['capacity'],
    })

    const plan = await planClassSize(course._id, 12, new Date('2026-08-15T00:00:00Z'))

    expect(plan.willChange).toBe(1)
    expect(plan.keptCustom).toBe(1)
  })

  it('reports a class that cannot shrink that far, and why', async () => {
    const course = await makeCourseType()
    await makeSession({
      courseTypeId: course._id,
      date: '2026-09-12',
      capacity: 8,
      seatsTaken: 6,
      title: 'IFDA Morning',
    })

    const plan = await planClassSize(course._id, 4, new Date('2026-08-15T00:00:00Z'))

    expect(plan.willChange).toBe(0)
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]).toMatchObject({ dateKey: '2026-09-12', title: 'IFDA Morning', occupied: 6 })
  })

  it('counts places held back as occupied, not as room to shrink into', async () => {
    const course = await makeCourseType()
    // 2 booked and 3 withheld for chat bookings: 5 places are spoken for, so 4 will not fit.
    await makeSession({ courseTypeId: course._id, capacity: 8, seatsTaken: 2, heldBack: 3 })

    const plan = await planClassSize(course._id, 4, new Date('2026-08-15T00:00:00Z'))

    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]!.occupied).toBe(5)
  })

  it('ignores classes that have already happened', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-07-01', capacity: 8 })
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })

    const plan = await planClassSize(course._id, 12, new Date('2026-08-15T00:00:00Z'))

    expect(plan.willChange).toBe(1)
  })

  it('ignores cancelled classes and other courses', async () => {
    const course = await makeCourseType()
    const other = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8, status: 'cancelled' })
    await makeSession({ courseTypeId: other._id, date: '2026-09-13', capacity: 8 })

    const plan = await planClassSize(course._id, 12, new Date('2026-08-15T00:00:00Z'))

    expect(plan.willChange).toBe(0)
  })
})

describe('applyClassSize', () => {
  const now = new Date('2026-08-15T00:00:00Z')

  it('writes the size to the course, the timetable rules and the calendar', async () => {
    const course = await makeCourseType({ defaultCapacity: 8 })
    const rule = await makeRule(course._id, 8)
    const session = await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })

    const result = await applyClassSize(course._id, 12, 'admin@example.com', now)

    expect(result.changed).toBe(1)

    // 1. The default a new one-off class starts with.
    expect((await CourseTypeModel.findById(course._id).lean())!.defaultCapacity).toBe(12)
    // 2. The number the generator will stamp on classes weeks ahead.
    expect((await ScheduleRuleModel.findById(rule._id).lean())!.capacity).toBe(12)
    // 3. The class a student actually books against.
    expect((await SessionModel.findById(session._id).lean())!.capacity).toBe(12)
  })

  it('does not touch a class whose size was set by hand', async () => {
    const course = await makeCourseType()
    const custom = await makeSession({
      courseTypeId: course._id,
      date: '2026-09-13',
      capacity: 4,
      overriddenFields: ['capacity'],
    })

    await applyClassSize(course._id, 12, 'admin@example.com', now)

    expect((await SessionModel.findById(custom._id).lean())!.capacity).toBe(4)
  })

  it('refuses to shrink a class below the students already in it', async () => {
    const course = await makeCourseType()
    const full = await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8, seatsTaken: 6 })
    const empty = await makeSession({ courseTypeId: course._id, date: '2026-09-13', capacity: 8 })

    const result = await applyClassSize(course._id, 4, 'admin@example.com', now)

    // The empty one shrinks; the one with students in it is reported, not forced.
    expect((await SessionModel.findById(empty._id).lean())!.capacity).toBe(4)
    expect((await SessionModel.findById(full._id).lean())!.capacity).toBe(8)
    expect(result.blocked).toHaveLength(1)
    expect(result.changed).toBe(1)
  })

  it('never leaves a class holding more students than it has places for', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8, seatsTaken: 6 })
    await makeSession({ courseTypeId: course._id, date: '2026-09-13', capacity: 8, seatsTaken: 2 })

    await applyClassSize(course._id, 4, 'admin@example.com', now)

    const sessions = await SessionModel.find({ courseTypeId: course._id }).lean()
    for (const s of sessions) {
      expect(s.seatsTaken + s.heldBack).toBeLessThanOrEqual(s.capacity)
    }
  })

  it('leaves classes that have already happened at their old size', async () => {
    const course = await makeCourseType()
    const past = await makeSession({ courseTypeId: course._id, date: '2026-07-01', capacity: 8 })

    await applyClassSize(course._id, 12, 'admin@example.com', now)

    expect((await SessionModel.findById(past._id).lean())!.capacity).toBe(8)
  })

  it('records what it did, so the change is not silent', async () => {
    const course = await makeCourseType({ defaultCapacity: 8 })
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })

    await applyClassSize(course._id, 12, 'admin@example.com', now)

    const entry = await AuditLogModel.findOne({ action: 'course.classSizeSet' }).lean()
    expect(entry).toBeTruthy()
    expect(entry!.after).toMatchObject({ defaultCapacity: 12, sessionsChanged: 1 })
  })
})

/**
 * The dashboard nags the studio to replace the placeholder size before going public. That nag
 * has to be clearable by doing what it asks — including when the size the studio chooses is 8,
 * which the old check could not tell apart from never having chosen at all.
 */
describe('the placeholder-size setup task', () => {
  const now = new Date('2026-08-15T00:00:00Z')

  it('is shown while every class still uses the untouched placeholder', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })

    const dashboard = await buildDashboard(now)

    expect(dashboard.actions.some((a) => a.kind === 'placeholder_capacity')).toBe(true)
  })

  it('clears once a size has been set', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })

    await applyClassSize(course._id, 12, 'admin@example.com', now)
    const dashboard = await buildDashboard(now)

    expect(dashboard.actions.some((a) => a.kind === 'placeholder_capacity')).toBe(false)
  })

  it('clears even when the studio deliberately chooses 8', async () => {
    const course = await makeCourseType()
    await makeSession({ courseTypeId: course._id, date: '2026-09-12', capacity: 8 })

    await applyClassSize(course._id, 8, 'admin@example.com', now)
    const dashboard = await buildDashboard(now)

    expect(dashboard.actions.some((a) => a.kind === 'placeholder_capacity')).toBe(false)
  })
})
