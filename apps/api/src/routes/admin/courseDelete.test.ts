import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../app.js'
import { signAdminToken, COOKIE_NAMES } from '../../auth/tokens.js'
import { AdminUserModel, CourseTypeModel, PackageModel, ScheduleRuleModel, SessionModel } from '../../models/index.js'
import { makeCourseType, makeSession, makeStudent } from '../../test/factories.js'

/**
 * Deleting a course.
 *
 * Archiving covers almost every case and keeps everything; this is for a course added by mistake.
 * The interesting behaviour is therefore the refusal, not the deletion — a course removed while
 * classes still point at it leaves sessions with no name, no colour and no rules, and bookings on
 * those sessions that students can still open.
 */

const app = createApp()

/*
 * A real admin row, not just a signed token: `requireAdmin` looks the account up and compares its
 * token version, so a hand-minted token for an id that does not exist is indistinguishable from
 * no token at all.
 */
let cookie: string
let course: Awaited<ReturnType<typeof makeCourseType>>

beforeEach(async () => {
  const admin = await AdminUserModel.create({
    name: 'Studio',
    email: 'studio@mizuki.com.sg',
    passwordHash: 'not-used-here',
    role: 'owner',
    active: true,
  })
  cookie = `${COOKIE_NAMES.admin}=${signAdminToken({
    sub: String(admin._id),
    email: admin.email,
    role: 'owner',
    v: admin.tokenVersion,
  })}`

  course = await makeCourseType({ name: 'Typo Course', slug: 'typo-course' })
})

const asAdmin = () => cookie

describe('deleting a course', () => {
  it('removes one that nothing points at', async () => {
    const res = await request(app)
      .delete(`/api/admin/settings/courses/${course._id}`)
      .set('Cookie', asAdmin())
      .expect(200)

    expect(res.body.deleted).toBe(true)
    expect(await CourseTypeModel.countDocuments({ _id: course._id })).toBe(0)
  })

  it('refuses while classes still belong to it, and says how many', async () => {
    await makeSession({ courseTypeId: course._id, date: '2026-09-19' })

    const res = await request(app)
      .delete(`/api/admin/settings/courses/${course._id}`)
      .set('Cookie', asAdmin())
      .expect(409)

    expect(res.body.error.code).toBe('course_in_use')
    expect(res.body.error.message).toContain('1 class')
    // The message has to name the way out, or it is just a locked door.
    expect(res.body.error.message).toMatch(/archive/i)

    // Nothing was removed on the way to refusing.
    expect(await CourseTypeModel.countDocuments({ _id: course._id })).toBe(1)
    expect(await SessionModel.countDocuments({ courseTypeId: course._id })).toBe(1)
  })

  it('refuses while a student still holds a package for it', async () => {
    const student = await makeStudent({ email: 'holder@example.com' })
    await PackageModel.create({
      studentId: student._id,
      courseTypeId: course._id,
      totalSessions: 8,
      usedSessions: 0,
      status: 'active',
      expiresAt: new Date('2027-12-31'),
    })

    const res = await request(app)
      .delete(`/api/admin/settings/courses/${course._id}`)
      .set('Cookie', asAdmin())
      .expect(409)

    expect(res.body.error.message).toContain('course package')
    expect(await CourseTypeModel.countDocuments({ _id: course._id })).toBe(1)
  })

  it('refuses while a weekly timetable rule still generates it', async () => {
    await ScheduleRuleModel.create({
      courseTypeId: course._id,
      title: 'Typo weekly',
      recurrence: { freq: 'WEEKLY', byWeekday: [2], interval: 1 },
      startTime: '10:00',
      durationMins: 150,
      capacity: 8,
      effectiveFrom: new Date('2026-01-01'),
      active: true,
    })

    const res = await request(app)
      .delete(`/api/admin/settings/courses/${course._id}`)
      .set('Cookie', asAdmin())
      .expect(409)

    expect(res.body.error.message).toContain('timetable rule')
  })

  it('is not something an unauthenticated caller can do', async () => {
    await request(app).delete(`/api/admin/settings/courses/${course._id}`).expect(401)
    expect(await CourseTypeModel.countDocuments({ _id: course._id })).toBe(1)
  })
})
