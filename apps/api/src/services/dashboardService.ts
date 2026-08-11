import { DateTime } from 'luxon'
import { STUDIO_TZ, isOverCapacity, seatsLeft, sessionsRemaining } from '@mizuki/shared'
import {
  AuditLogModel,
  BookingModel,
  CourseSeriesModel,
  CourseTypeModel,
  PackageModel,
  SessionModel,
  StudentModel,
} from '../models/index.js'
import { findSeatDrift } from './seatService.js'
import { hoursSinceLastBackup } from './backupService.js'
import { config } from '../config.js'

/**
 * Everything the studio's landing page shows, in one query pass.
 *
 * The organising idea is that the first thing on screen should be what needs a decision today,
 * not a wall of numbers. Anything that could strand a student — a class over capacity, a course
 * package about to expire with sessions unused, a shop product that was never linked — is
 * surfaced as an action with somewhere to go, rather than left for someone to notice.
 */

export type ActionSeverity = 'urgent' | 'attention' | 'info'

export interface DashboardAction {
  kind: string
  severity: ActionSeverity
  title: string
  subtitle: string
  /** Where clicking it goes, within the console. */
  href: string
}

export interface DashboardData {
  generatedAt: string
  today: string
  stats: {
    classesToday: number
    studentsToday: number
    studentsThisWeek: number
    placesLeftThisWeek: number
    bookingsThisMonth: number
    activeStudents: number
  }
  actions: DashboardAction[]
  todayClasses: ClassRow[]
  upcomingClasses: ClassRow[]
  bookingMix: { confirmed: number; held: number; cancelled: number }
  weekFill: { booked: number; capacity: number; percent: number }
  packagesLow: { studentName: string; courseName: string; remaining: number; expiresAt: string | null }[]
  recentActivity: { id: string; action: string; actor: string; reason: string; at: string }[]
}

export interface ClassRow {
  id: string
  title: string
  courseName: string
  colour: string
  startAt: string
  dateKey: string
  seatsTaken: number
  capacity: number
  seatsLeft: number
  heldBack: number
  isFull: boolean
  overCapacity: boolean
  status: string
}

export async function buildDashboard(now: Date = new Date()): Promise<DashboardData> {
  const studioNow = DateTime.fromJSDate(now).setZone(STUDIO_TZ)
  const todayKey = studioNow.toFormat('yyyy-MM-dd')
  const weekEndKey = studioNow.plus({ days: 7 }).toFormat('yyyy-MM-dd')

  const courses = await CourseTypeModel.find().lean()
  const courseById = new Map(courses.map((c) => [String(c._id), c]))

  const [todaySessions, weekSessions, upcoming] = await Promise.all([
    SessionModel.find({ dateKey: todayKey, status: 'scheduled' }).sort({ startAt: 1 }).lean(),
    SessionModel.find({ dateKey: { $gte: todayKey, $lte: weekEndKey }, status: 'scheduled' }).lean(),
    SessionModel.find({ startAt: { $gte: now }, status: 'scheduled' }).sort({ startAt: 1 }).limit(8).lean(),
  ])

  const toRow = (s: (typeof weekSessions)[number]): ClassRow => {
    const course = courseById.get(String(s.courseTypeId))
    return {
      id: String(s._id),
      title: s.title || course?.name || 'Class',
      courseName: course?.name ?? '—',
      colour: course?.colour ?? '#94a3b8',
      startAt: s.startAt.toISOString(),
      dateKey: s.dateKey,
      seatsTaken: s.seatsTaken,
      capacity: s.capacity,
      seatsLeft: seatsLeft(s),
      heldBack: s.heldBack,
      isFull: seatsLeft(s) === 0,
      overCapacity: isOverCapacity(s),
      status: s.status,
    }
  }

  const monthStart = studioNow.startOf('month').toJSDate()

  const [bookingsThisMonth, confirmedCount, heldCount, cancelledCount, activeStudents] = await Promise.all([
    BookingModel.countDocuments({ createdAt: { $gte: monthStart }, status: { $ne: 'cancelled' } }),
    BookingModel.countDocuments({ status: 'confirmed' }),
    BookingModel.countDocuments({ status: 'hold' }),
    BookingModel.countDocuments({ status: 'cancelled', cancelledAt: { $gte: monthStart } }),
    StudentModel.countDocuments(),
  ])

  const studentsToday = todaySessions.reduce((sum, s) => sum + s.seatsTaken, 0)
  const weekBooked = weekSessions.reduce((sum, s) => sum + s.seatsTaken, 0)
  const weekCapacity = weekSessions.reduce((sum, s) => sum + s.capacity, 0)
  const weekPlacesLeft = weekSessions.reduce((sum, s) => sum + seatsLeft(s), 0)

  const [actions, packagesLow, recentActivity] = await Promise.all([
    buildActions(now, todayKey, weekSessions, courseById),
    findLowPackages(now),
    recentAudit(),
  ])

  return {
    generatedAt: now.toISOString(),
    today: todayKey,
    stats: {
      classesToday: todaySessions.length,
      studentsToday,
      studentsThisWeek: weekBooked,
      placesLeftThisWeek: weekPlacesLeft,
      bookingsThisMonth,
      activeStudents,
    },
    actions,
    todayClasses: todaySessions.map(toRow),
    upcomingClasses: upcoming.map(toRow),
    bookingMix: { confirmed: confirmedCount, held: heldCount, cancelled: cancelledCount },
    weekFill: {
      booked: weekBooked,
      capacity: weekCapacity,
      percent: weekCapacity > 0 ? Math.round((weekBooked / weekCapacity) * 100) : 0,
    },
    packagesLow,
    recentActivity,
  }
}

/**
 * The "things that need you today" list.
 *
 * Ordered by how much it costs to miss: a student stranded or a payment stuck first, setup gaps
 * that quietly break the shop next, gentle nudges last.
 */
async function buildActions(
  now: Date,
  todayKey: string,
  weekSessions: { _id: unknown; title: string; dateKey: string; capacity: number; heldBack: number; seatsTaken: number }[],
  courseById: Map<string, { name: string; wooProductIds?: number[]; bookingMode: string; packageGrantSessions?: number }>,
): Promise<DashboardAction[]> {
  const actions: DashboardAction[] = []

  // Someone is booked into a class that no longer has room for them.
  for (const session of weekSessions.filter((s) => isOverCapacity(s))) {
    actions.push({
      kind: 'over_capacity',
      severity: 'urgent',
      title: `${session.title} is over capacity`,
      subtitle: `${session.seatsTaken} booked into ${session.capacity} places — someone needs moving`,
      href: `/calendar?session=${session._id}`,
    })
  }

  // Money taken with no place to show for it.
  const strandedPayments = await BookingModel.countDocuments({ status: 'hold', holdExpiresAt: { $lt: now } })
  if (strandedPayments > 0) {
    actions.push({
      kind: 'stale_holds',
      severity: 'attention',
      title: `${strandedPayments} place${strandedPayments === 1 ? '' : 's'} held past the checkout window`,
      subtitle: 'They release on the next scheduled run',
      href: '/settings',
    })
  }

  const drift = await findSeatDrift(now)
  if (drift.length > 0) {
    actions.push({
      kind: 'seat_drift',
      severity: 'urgent',
      title: `${drift.length} class${drift.length === 1 ? '' : 'es'} have mismatched place counts`,
      subtitle: 'The counter disagrees with the bookings — worth a look',
      href: '/settings',
    })
  }

  // Setup gaps that silently break the shop rather than failing loudly.
  const seriesMissingProduct = await CourseSeriesModel.find({ active: true, wooProductId: null }).lean()
  for (const series of seriesMissingProduct) {
    actions.push({
      kind: 'series_unlinked',
      severity: 'attention',
      title: `${series.name} has no shop product`,
      subtitle: 'Buying it in the shop will not book anything until this is set',
      href: '/settings',
    })
  }

  for (const [, course] of courseById) {
    if (course.bookingMode === 'paid' && (course.wooProductIds?.length ?? 0) === 0) {
      actions.push({
        kind: 'course_unlinked',
        severity: 'info',
        title: `${course.name} has no shop product linked`,
        subtitle: 'Students cannot pay for these workshops yet',
        href: '/settings',
      })
    }
  }

  // Course packages running out or timing out.
  const expiringSoon = DateTime.fromJSDate(now).plus({ days: 14 }).toJSDate()
  const expiring = await PackageModel.find({
    status: 'active',
    expiresAt: { $ne: null, $gt: now, $lte: expiringSoon },
  })
    .limit(5)
    .lean()

  for (const pkg of expiring) {
    if (sessionsRemaining(pkg) <= 0) continue
    const student = await StudentModel.findById(pkg.studentId).select('name').lean()
    actions.push({
      kind: 'package_expiring',
      severity: 'attention',
      title: `${student?.name ?? 'A student'}'s course expires soon`,
      subtitle: `${sessionsRemaining(pkg)} session(s) unused, expires ${DateTime.fromJSDate(pkg.expiresAt!).setZone(STUDIO_TZ).toFormat('d LLL')}`,
      href: '/students',
    })
  }

  /*
   * Students on file with no contact number.
   *
   * A number is required to book now, but anyone added before that — or created from a shop
   * order with no billing phone — still has none. Worth chasing, because the one time it
   * matters is a class cancelled at short notice, when email is too slow.
   */
  const noPhone = await StudentModel.countDocuments({ $or: [{ phone: '' }, { phone: null }] })
  if (noPhone > 0) {
    actions.push({
      kind: 'missing_phone',
      severity: 'info',
      title: `${noPhone} student${noPhone === 1 ? ' has' : 's have'} no phone number`,
      subtitle: 'You could not reach them if a class changed at short notice',
      href: '/students?missingPhone=1',
    })
  }

  const backupAge = await hoursSinceLastBackup(now)
  if (backupAge === null) {
    actions.push({
      kind: 'no_backup',
      severity: 'urgent',
      title: 'No backup has ever been taken',
      subtitle: 'Bookings and course balances could not be recovered if the database were lost',
      href: '/settings',
    })
  } else if (backupAge > 48) {
    actions.push({
      kind: 'stale_backup',
      severity: 'urgent',
      title: `The last backup is ${Math.floor(backupAge / 24)} days old`,
      subtitle: 'The nightly backup has stopped running',
      href: '/settings',
    })
  }

  // Today's classes, so the day is visible without opening the calendar.
  const todayCount = weekSessions.filter((s) => s.dateKey === todayKey).length
  if (todayCount > 0) {
    const booked = weekSessions.filter((s) => s.dateKey === todayKey).reduce((n, s) => n + s.seatsTaken, 0)
    actions.push({
      kind: 'today',
      severity: 'info',
      title: `${todayCount} class${todayCount === 1 ? '' : 'es'} today`,
      subtitle: `${booked} student${booked === 1 ? '' : 's'} expected`,
      href: '/calendar',
    })
  }

  // Placeholder class sizes are a setup task the studio must finish before going public.
  const placeholderCount = await SessionModel.countDocuments({ capacity: 8, startAt: { $gte: now } })
  const totalUpcoming = await SessionModel.countDocuments({ startAt: { $gte: now } })
  if (totalUpcoming > 0 && placeholderCount === totalUpcoming) {
    actions.push({
      kind: 'placeholder_capacity',
      severity: 'attention',
      title: 'Every class still uses the placeholder size of 8',
      subtitle: 'Set your real class sizes before the calendar goes public',
      href: '/settings',
    })
  }

  const order: Record<ActionSeverity, number> = { urgent: 0, attention: 1, info: 2 }
  return actions.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 12)
}

async function findLowPackages(now: Date) {
  const packages = await PackageModel.find({ status: 'active' }).limit(60).lean()

  const rows = []
  for (const pkg of packages) {
    const remaining = sessionsRemaining(pkg)
    if (remaining > 2) continue

    const [student, course] = await Promise.all([
      StudentModel.findById(pkg.studentId).select('name').lean(),
      CourseTypeModel.findById(pkg.courseTypeId).select('name').lean(),
    ])

    rows.push({
      studentName: student?.name ?? 'Unknown',
      courseName: course?.name ?? '—',
      remaining,
      expiresAt: pkg.expiresAt ? pkg.expiresAt.toISOString() : null,
    })
  }

  return rows.slice(0, 6)
}

async function recentAudit() {
  const entries = await AuditLogModel.find().sort({ createdAt: -1 }).limit(10).lean()
  return entries.map((e) => ({
    id: String(e._id),
    action: e.action,
    actor: e.actor.replace(/^(admin|student|woo|system):?/, '') || 'system',
    reason: e.reason ?? '',
    at: (e.createdAt as Date).toISOString(),
  }))
}

export const CALENDAR_MONTHS_AHEAD = config.CALENDAR_MONTHS_AHEAD
