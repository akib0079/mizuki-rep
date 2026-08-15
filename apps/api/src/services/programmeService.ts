import { Types } from 'mongoose'
import { DateTime } from 'luxon'
import { ACTIVE_BOOKING_STATUSES, STUDIO_TZ, isOverCapacity, seatsLeft, sessionsRemaining } from '@mizuki/shared'
import {
  BookingModel,
  CourseTypeModel,
  PackageModel,
  SessionModel,
  StudentModel,
} from '../models/index.js'
import { NotFoundError } from '../errors.js'

/**
 * A course that is run as a programme, and managed in its own section of the console.
 *
 * IFDA is why this exists. Mixed into the shared dashboard it was not one course among five —
 * it was 121 of 139 classes, so the workshops were invisible behind it. And the shared dashboard
 * answered none of the questions the studio actually has about it, because those questions are
 * about people rather than classes: who is enrolled, how many sessions each has left, whose
 * course is about to expire.
 *
 * So this is not a filtered copy of the dashboard. It is the other half of the information —
 * the enrolment register — with only as much of the timetable as makes it readable.
 */

export interface ProgrammeSummary {
  id: string
  name: string
  colour: string
}

export interface ProgrammeClass {
  id: string
  title: string
  startAt: string
  dateKey: string
  seatsTaken: number
  capacity: number
  seatsLeft: number
  isFull: boolean
  overCapacity: boolean
}

export interface EnrolledStudent {
  id: string
  name: string
  email: string
  phone: string
  reference: string | null
  /** Places left on their course package. */
  remaining: number
  totalSessions: number
  usedSessions: number
  startsAt: string | null
  expiresAt: string | null
  /** Classes of this course they are booked into from now on. */
  upcomingBookings: number
  nextClassAt: string | null
  /** Why the studio might need to act: running out, expiring, or enrolled but not booked in. */
  flag: 'none' | 'low_balance' | 'expiring' | 'not_booked' | 'exhausted'
}

export interface ProgrammeOverview {
  course: { id: string; name: string; colour: string; defaultCapacity: number; bookingMode: string }
  stats: {
    enrolled: number
    classesThisWeek: number
    studentsThisWeek: number
    placesLeftThisWeek: number
    needAttention: number
  }
  todayClasses: ProgrammeClass[]
  upcomingClasses: ProgrammeClass[]
  students: EnrolledStudent[]
}

/** The courses that have their own section, for the console's navigation. */
export async function listProgrammes(): Promise<ProgrammeSummary[]> {
  const courses = await CourseTypeModel.find({ managedSeparately: true, active: true })
    .sort({ sortOrder: 1 })
    .select('name colour')
    .lean()
  return courses.map((c) => ({ id: String(c._id), name: c.name, colour: c.colour }))
}

/** Ids only — what the shared dashboard needs in order to leave these courses out. */
export async function separatedCourseIds(): Promise<Types.ObjectId[]> {
  const courses = await CourseTypeModel.find({ managedSeparately: true }).select('_id').lean()
  return courses.map((c) => c._id)
}

const toClass = (s: {
  _id: unknown
  title: string
  startAt: Date
  dateKey: string
  seatsTaken: number
  capacity: number
  heldBack: number
}): ProgrammeClass => ({
  id: String(s._id),
  title: s.title || 'Class',
  startAt: s.startAt.toISOString(),
  dateKey: s.dateKey,
  seatsTaken: s.seatsTaken,
  capacity: s.capacity,
  seatsLeft: seatsLeft(s),
  isFull: seatsLeft(s) === 0,
  overCapacity: isOverCapacity(s),
})

/** How soon a course package counts as "about to run out". */
const LOW_BALANCE = 2
const EXPIRING_DAYS = 30

export async function buildProgramme(
  courseIdInput: Types.ObjectId | string,
  now: Date = new Date(),
): Promise<ProgrammeOverview> {
  const courseId = new Types.ObjectId(String(courseIdInput))
  const course = await CourseTypeModel.findById(courseId).lean()
  if (!course) throw new NotFoundError('Course')

  const studioNow = DateTime.fromJSDate(now).setZone(STUDIO_TZ)
  const todayKey = studioNow.toFormat('yyyy-MM-dd')
  const weekEndKey = studioNow.plus({ days: 7 }).toFormat('yyyy-MM-dd')

  const [todaySessions, weekSessions, upcoming, packages] = await Promise.all([
    SessionModel.find({ courseTypeId: courseId, dateKey: todayKey, status: 'scheduled' })
      .sort({ startAt: 1 })
      .lean(),
    SessionModel.find({
      courseTypeId: courseId,
      dateKey: { $gte: todayKey, $lte: weekEndKey },
      status: 'scheduled',
    }).lean(),
    SessionModel.find({ courseTypeId: courseId, startAt: { $gte: now }, status: 'scheduled' })
      .sort({ startAt: 1 })
      .limit(10)
      .lean(),
    PackageModel.find({ courseTypeId: courseId, status: 'active' }).sort({ createdAt: -1 }).lean(),
  ])

  /*
   * The register, built from packages rather than from bookings.
   *
   * A student who has bought the course but not booked anything yet is still enrolled — and is
   * precisely the one the studio most needs to see, because nothing else in the console will
   * ever mention them. Building this from bookings would leave them out entirely.
   */
  const studentIds = packages.map((p) => p.studentId)
  const [students, upcomingBookings] = await Promise.all([
    StudentModel.find({ _id: { $in: studentIds }, mergedInto: null })
      .select('name email phone reference')
      .lean(),
    BookingModel.find({
      studentId: { $in: studentIds },
      status: { $in: ACTIVE_BOOKING_STATUSES },
    })
      .select('studentId sessionId')
      .lean(),
  ])

  const studentById = new Map(students.map((s) => [String(s._id), s]))

  /*
   * A student's bookings on *this* course, still ahead of now.
   *
   * The booking rows do not name a course, only a class, so the classes have to be looked up to
   * know which bookings count. Fetched once as id → start time: the id filters the bookings, the
   * start time gives "next class" without a second pass.
   */
  const futureStartById = new Map(
    (
      await SessionModel.find({ courseTypeId: courseId, startAt: { $gte: now }, status: 'scheduled' })
        .select('startAt')
        .lean()
    ).map((s) => [String(s._id), s.startAt]),
  )

  const bookingsByStudent = new Map<string, Date[]>()
  for (const b of upcomingBookings) {
    const startAt = futureStartById.get(String(b.sessionId))
    if (!startAt) continue
    const key = String(b.studentId)
    bookingsByStudent.set(key, [...(bookingsByStudent.get(key) ?? []), startAt])
  }

  const expiringBefore = studioNow.plus({ days: EXPIRING_DAYS }).toJSDate()

  const roster: EnrolledStudent[] = []
  for (const pkg of packages) {
    const student = studentById.get(String(pkg.studentId))
    if (!student) continue

    const remaining = sessionsRemaining(pkg)
    const booked = (bookingsByStudent.get(String(pkg.studentId)) ?? []).sort(
      (a, b) => a.getTime() - b.getTime(),
    )

    let flag: EnrolledStudent['flag'] = 'none'
    if (remaining <= 0) flag = 'exhausted'
    else if (pkg.expiresAt && pkg.expiresAt <= expiringBefore) flag = 'expiring'
    else if (remaining <= LOW_BALANCE) flag = 'low_balance'
    else if (booked.length === 0) flag = 'not_booked'

    roster.push({
      id: String(student._id),
      name: student.name,
      email: student.email,
      phone: student.phone ?? '',
      reference: student.reference ?? null,
      remaining,
      totalSessions: pkg.totalSessions,
      usedSessions: pkg.usedSessions,
      startsAt: pkg.startsAt ? pkg.startsAt.toISOString() : null,
      expiresAt: pkg.expiresAt ? pkg.expiresAt.toISOString() : null,
      upcomingBookings: booked.length,
      nextClassAt: booked[0] ? booked[0].toISOString() : null,
      flag,
    })
  }

  // Anyone needing action first, then by who runs out soonest — the order the studio works in.
  const flagOrder: Record<EnrolledStudent['flag'], number> = {
    exhausted: 0,
    expiring: 1,
    low_balance: 2,
    not_booked: 3,
    none: 4,
  }
  roster.sort((a, b) => flagOrder[a.flag] - flagOrder[b.flag] || a.remaining - b.remaining)

  return {
    course: {
      id: String(course._id),
      name: course.name,
      colour: course.colour,
      defaultCapacity: course.defaultCapacity,
      bookingMode: course.bookingMode,
    },
    stats: {
      enrolled: roster.length,
      classesThisWeek: weekSessions.length,
      studentsThisWeek: weekSessions.reduce((n, s) => n + s.seatsTaken, 0),
      placesLeftThisWeek: weekSessions.reduce((n, s) => n + seatsLeft(s), 0),
      needAttention: roster.filter((r) => r.flag !== 'none').length,
    },
    todayClasses: todaySessions.map(toClass),
    upcomingClasses: upcoming.map(toClass),
    students: roster,
  }
}
