import { describe, expect, it } from 'vitest'
import { BookingModel } from '../models/index.js'
import { makeCourseType, makePackage, makeSession, makeStudent } from '../test/factories.js'
import { buildProgramme, listProgrammes } from './programmeService.js'
import { buildDashboard } from './dashboardService.js'

/**
 * A course run as a programme, on its own page.
 *
 * The behaviour worth pinning down is not the layout but the split: everything the programme
 * page counts, the shared dashboard must not, or the studio reads the same class twice under
 * two different headings and cannot tell which number is the studio's.
 */

const NOW = new Date('2026-08-15T00:00:00Z')

const ifda = () => makeCourseType({ name: 'IFDA', managedSeparately: true })
const workshop = () => makeCourseType({ name: 'Ikebana' })

describe('listProgrammes', () => {
  it('returns only the courses given their own section', async () => {
    await ifda()
    await workshop()

    const programmes = await listProgrammes()

    expect(programmes.map((p) => p.name)).toEqual(['IFDA'])
  })

  it('leaves out an archived course, which has no page to link to', async () => {
    await makeCourseType({ name: 'Retired', managedSeparately: true, active: false })

    expect(await listProgrammes()).toEqual([])
  })
})

describe('the enrolment register', () => {
  it('lists a student who has bought the course but booked nothing yet', async () => {
    // The whole reason the register is built from packages: this student appears nowhere else
    // in the console, and is exactly who the studio needs to chase.
    const course = await ifda()
    const student = await makeStudent({ name: 'Aiko Tan' })
    await makePackage(student._id, course._id, { totalSessions: 8, usedSessions: 0 })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students).toHaveLength(1)
    expect(programme.students[0]).toMatchObject({
      name: 'Aiko Tan',
      remaining: 8,
      upcomingBookings: 0,
      nextClassAt: null,
      flag: 'not_booked',
    })
  })

  it('counts sessions left, and flags a balance running out', async () => {
    const course = await ifda()
    const student = await makeStudent()
    await makePackage(student._id, course._id, { totalSessions: 8, usedSessions: 7 })
    // Booked into something, so "not booked" is not what is being tested.
    const session = await makeSession({ courseTypeId: course._id, date: '2026-09-12' })
    await BookingModel.create({ sessionId: session._id, studentId: student._id, status: 'confirmed', source: 'admin_manual' })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students[0]).toMatchObject({ remaining: 1, flag: 'low_balance' })
  })

  it('flags a student who has used every session', async () => {
    const course = await ifda()
    const student = await makeStudent()
    await makePackage(student._id, course._id, { totalSessions: 8, usedSessions: 8 })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students[0]).toMatchObject({ remaining: 0, flag: 'exhausted' })
  })

  it('flags a course period about to end', async () => {
    const course = await ifda()
    const student = await makeStudent()
    await makePackage(student._id, course._id, {
      totalSessions: 8,
      usedSessions: 1,
      expiresAt: new Date('2026-08-30T00:00:00Z'),
    })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students[0]!.flag).toBe('expiring')
  })

  it('reports the next class a student is actually booked into', async () => {
    const course = await ifda()
    const student = await makeStudent()
    await makePackage(student._id, course._id)
    const soon = await makeSession({ courseTypeId: course._id, date: '2026-09-12' })
    const later = await makeSession({ courseTypeId: course._id, date: '2026-10-10' })
    for (const s of [later, soon]) {
      await BookingModel.create({ sessionId: s._id, studentId: student._id, status: 'confirmed', source: 'admin_manual' })
    }

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students[0]!.upcomingBookings).toBe(2)
    expect(programme.students[0]!.nextClassAt).toBe(soon.startAt.toISOString())
  })

  it('ignores a booking on another course', async () => {
    const course = await ifda()
    const other = await workshop()
    const student = await makeStudent()
    await makePackage(student._id, course._id)
    const elsewhere = await makeSession({ courseTypeId: other._id, date: '2026-09-12' })
    await BookingModel.create({ sessionId: elsewhere._id, studentId: student._id, status: 'confirmed', source: 'admin_manual' })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students[0]).toMatchObject({ upcomingBookings: 0, flag: 'not_booked' })
  })

  it('puts the students needing action at the top', async () => {
    const course = await ifda()
    const [fine, empty] = [await makeStudent({ name: 'Fine' }), await makeStudent({ name: 'Empty' })]
    await makePackage(fine._id, course._id, { totalSessions: 8, usedSessions: 0 })
    await makePackage(empty._id, course._id, { totalSessions: 8, usedSessions: 8 })
    // Give the healthy one a booking so it is not flagged as unbooked.
    const session = await makeSession({ courseTypeId: course._id, date: '2026-09-12' })
    await BookingModel.create({ sessionId: session._id, studentId: fine._id, status: 'confirmed', source: 'admin_manual' })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.students.map((s) => s.name)).toEqual(['Empty', 'Fine'])
    expect(programme.stats.needAttention).toBe(1)
  })
})

describe('keeping the two apart', () => {
  it('counts the programme’s classes on its own page', async () => {
    const course = await ifda()
    await makeSession({ courseTypeId: course._id, date: '2026-08-17' })

    const programme = await buildProgramme(course._id, NOW)

    expect(programme.stats.classesThisWeek).toBe(1)
  })

  it('leaves the programme out of the shared dashboard entirely', async () => {
    const course = await ifda()
    const other = await workshop()
    await makeSession({ courseTypeId: course._id, date: '2026-08-17', title: 'IFDA Morning' })
    await makeSession({ courseTypeId: other._id, date: '2026-08-17', title: 'Ikebana Workshop' })

    const dashboard = await buildDashboard(NOW)

    // One class this week, not two, and it is the workshop.
    expect(dashboard.upcomingClasses.map((c) => c.title)).toEqual(['Ikebana Workshop'])
    expect(dashboard.stats.studentsThisWeek).toBe(0)
    expect(dashboard.separateCourses).toEqual(['IFDA'])
  })

  it('leaves the programme’s low balances to its own page', async () => {
    const course = await ifda()
    const other = await workshop()
    const [enrolled, workshopper] = [await makeStudent({ name: 'Enrolled' }), await makeStudent({ name: 'Workshopper' })]
    await makePackage(enrolled._id, course._id, { totalSessions: 8, usedSessions: 7 })
    await makePackage(workshopper._id, other._id, { totalSessions: 8, usedSessions: 7 })

    const dashboard = await buildDashboard(NOW)

    expect(dashboard.packagesLow.map((p) => p.studentName)).toEqual(['Workshopper'])
  })

  it('leaves the programme’s bookings out of this month’s count', async () => {
    // The page says in words that a separated course is not counted below. This is the figure
    // that would quietly have counted it anyway.
    const course = await ifda()
    const other = await workshop()
    const student = await makeStudent()
    const ifdaClass = await makeSession({ courseTypeId: course._id, date: '2026-09-12' })
    const workshopClass = await makeSession({ courseTypeId: other._id, date: '2026-09-13' })
    for (const s of [ifdaClass, workshopClass]) {
      await BookingModel.create({ sessionId: s._id, studentId: student._id, status: 'confirmed', source: 'admin_manual' })
    }

    const dashboard = await buildDashboard(NOW)

    expect(dashboard.stats.bookingsThisMonth).toBe(1)
  })

  it('counts every booking when no course is separated', async () => {
    const other = await workshop()
    const student = await makeStudent()
    const session = await makeSession({ courseTypeId: other._id, date: '2026-09-13' })
    await BookingModel.create({ sessionId: session._id, studentId: student._id, status: 'confirmed', source: 'admin_manual' })

    const dashboard = await buildDashboard(NOW)

    expect(dashboard.stats.bookingsThisMonth).toBe(1)
  })

  it('says nothing about separate courses when there are none', async () => {
    await workshop()

    const dashboard = await buildDashboard(NOW)

    expect(dashboard.separateCourses).toEqual([])
  })
})
