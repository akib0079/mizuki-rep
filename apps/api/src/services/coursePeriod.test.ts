import { beforeEach, describe, expect, it } from 'vitest'
import { PackageModel } from '../models/index.js'
import { adjustPackage, grantSessions, summarisePackages } from './packageService.js'
import { makeCourseType, makeStudent } from '../test/factories.js'

/**
 * The course period.
 *
 * A package always had an end date because expiry is what the system enforces. It never had a
 * start, so a course sold in November to run from January silently began the day it was created —
 * a fact that lived in somebody's memory and nowhere else. The studio asked to set both ends and
 * to move either at any time, which is what these cover.
 */

let student: Awaited<ReturnType<typeof makeStudent>>
let course: Awaited<ReturnType<typeof makeCourseType>>

beforeEach(async () => {
  student = await makeStudent({ email: 'period@example.com' })
  course = await makeCourseType({ name: 'IFDA', slug: 'ifda-period', bookingMode: 'package' })
})

describe('a course period', () => {
  it('is kept when the package is created', async () => {
    const pkg = await grantSessions({
      studentId: student._id,
      courseTypeId: course._id,
      totalSessions: 25,
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-11-30T23:59:59Z'),
    })

    expect(pkg.startsAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(pkg.totalSessions).toBe(25)
  })

  it('is optional at both ends — an open package has neither', async () => {
    const pkg = await grantSessions({
      studentId: student._id,
      courseTypeId: course._id,
      totalSessions: 8,
    })

    expect(pkg.startsAt).toBeNull()
    expect(pkg.expiresAt).toBeNull()
  })

  it('reaches the student record the console reads', async () => {
    await grantSessions({
      studentId: student._id,
      courseTypeId: course._id,
      totalSessions: 25,
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-11-30T23:59:59Z'),
    })

    const [summary] = await summarisePackages(student._id)
    expect(summary!.startsAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(summary!.remaining).toBe(25)
  })

  describe('changing it afterwards', () => {
    it('moves the end date without touching the start', async () => {
      const pkg = await grantSessions({
        studentId: student._id,
        courseTypeId: course._id,
        totalSessions: 25,
        startsAt: new Date('2026-09-01T00:00:00Z'),
        expiresAt: new Date('2026-11-30T23:59:59Z'),
      })

      const after = await adjustPackage(pkg._id, {
        extendToDate: new Date('2027-02-28T23:59:59Z'),
        note: 'Needs longer',
      })

      expect(after.expiresAt?.toISOString()).toBe('2027-02-28T23:59:59.000Z')
      // The whole point of two fields: extending must not restate a start nobody changed.
      expect(after.startsAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    })

    it('moves the start date without touching the end', async () => {
      const pkg = await grantSessions({
        studentId: student._id,
        courseTypeId: course._id,
        totalSessions: 25,
        startsAt: new Date('2026-09-01T00:00:00Z'),
        expiresAt: new Date('2026-11-30T23:59:59Z'),
      })

      const after = await adjustPackage(pkg._id, { setStartDate: new Date('2026-10-01T00:00:00Z') })

      expect(after.startsAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
      expect(after.expiresAt?.toISOString()).toBe('2026-11-30T23:59:59.000Z')
    })

    it('records the change, so a period nobody remembers moving can be traced', async () => {
      const pkg = await grantSessions({
        studentId: student._id,
        courseTypeId: course._id,
        totalSessions: 25,
      })

      await adjustPackage(pkg._id, { setStartDate: new Date('2026-10-01T00:00:00Z'), by: 'admin:studio@mizuki.com.sg' })

      const saved = await PackageModel.findById(pkg._id)
      const entry = saved!.ledger.at(-1)
      expect(entry!.by).toBe('admin:studio@mizuki.com.sg')
      expect(entry!.note).toContain('Start')
    })

    it('still adds sessions and extends time in one go', async () => {
      const pkg = await grantSessions({
        studentId: student._id,
        courseTypeId: course._id,
        totalSessions: 25,
        expiresAt: new Date('2026-11-30T23:59:59Z'),
      })

      const after = await adjustPackage(pkg._id, {
        addSessions: 5,
        extendToDate: new Date('2027-02-28T23:59:59Z'),
      })

      expect(after.totalSessions).toBe(30)
      expect(after.expiresAt?.toISOString()).toBe('2027-02-28T23:59:59.000Z')
    })
  })
})
