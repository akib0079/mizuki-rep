import type { Types } from 'mongoose'
import { ACTIVE_BOOKING_STATUSES } from '@mizuki/shared'
import { BookingModel, PackageModel, SessionModel, StudentModel } from '../models/index.js'
import { releaseSeat } from './seatService.js'
import { recordAudit } from './auditService.js'
import { NotFoundError } from '../errors.js'
import { logger } from '../logger.js'

/**
 * Removing a student for good.
 *
 * Merging covers the common case — two records, one person — and keeps everything. This is the
 * other one: a test entry, a typo, someone who asked to be forgotten. There is nothing to keep,
 * and leaving the row means the studio scrolls past it forever.
 *
 * The part that has to be right is the seat counters. A booking row deleted on its own leaves
 * `seatsTaken` counting a person who no longer exists, and nothing ever corrects it — the class
 * shows one place fewer than it has, for the rest of its life, and the nightly drift check
 * reports it as a fault every morning. So every live place is released before its booking goes.
 *
 * Deleting is told apart from cancelling deliberately: nobody is emailed. A cancellation notice
 * to someone the studio has just erased is the opposite of what was asked for.
 */

export interface DeletionPreview {
  id: string
  name: string
  email: string
  /** Places in classes that have not happened yet — the ones worth being warned about. */
  upcomingBookings: { title: string; when: Date }[]
  totalBookings: number
  packages: number
  /** Course sessions the student has paid for and not used. */
  unusedSessions: number
}

/** What deleting this student would remove, so the studio is told before rather than after. */
export async function previewStudentDeletion(
  studentId: Types.ObjectId | string,
  now: Date = new Date(),
): Promise<DeletionPreview> {
  const student = await StudentModel.findById(studentId).lean()
  if (!student) throw new NotFoundError('Student')

  const [bookings, packages] = await Promise.all([
    BookingModel.find({ studentId: student._id }).lean(),
    PackageModel.find({ studentId: student._id }).lean(),
  ])

  const liveIds = bookings
    .filter((b) => (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(b.status))
    .map((b) => b.sessionId)

  const sessions = await SessionModel.find({ _id: { $in: liveIds }, startAt: { $gt: now } })
    .sort({ startAt: 1 })
    .select('title startAt')
    .lean()

  return {
    id: String(student._id),
    name: student.name,
    email: student.email,
    upcomingBookings: sessions.map((s) => ({ title: s.title, when: s.startAt })),
    totalBookings: bookings.length,
    packages: packages.length,
    unusedSessions: packages
      .filter((p) => p.status === 'active')
      .reduce((sum, p) => sum + Math.max(0, p.totalSessions - p.usedSessions), 0),
  }
}

export interface DeletionResult {
  name: string
  email: string
  bookingsRemoved: number
  seatsFreed: number
  packagesRemoved: number
}

export async function deleteStudent(
  studentId: Types.ObjectId | string,
  actor: string,
): Promise<DeletionResult> {
  const student = await StudentModel.findById(studentId)
  if (!student) throw new NotFoundError('Student')

  const bookings = await BookingModel.find({ studentId: student._id })

  /*
   * Free the places first, one at a time, and only for bookings that were actually holding one.
   * A cancelled booking released its seat when it was cancelled; decrementing again here would
   * take a place off a class that has since been filled by somebody real.
   */
  let seatsFreed = 0
  for (const booking of bookings) {
    if (!(ACTIVE_BOOKING_STATUSES as readonly string[]).includes(booking.status)) continue
    await releaseSeat(booking.sessionId)
    seatsFreed++
  }

  const [removedBookings, removedPackages] = await Promise.all([
    BookingModel.deleteMany({ studentId: student._id }),
    PackageModel.deleteMany({ studentId: student._id }),
  ])

  /*
   * Written before the row goes, and holding the details in the entry itself rather than only an
   * id: an audit line pointing at a student who no longer exists answers nothing afterwards.
   */
  await recordAudit({
    actor,
    action: 'student.delete',
    entity: 'Student',
    entityId: student._id,
    before: { name: student.name, email: student.email, reference: student.reference },
    reason:
      `Deleted ${student.name} <${student.email}>, along with ${removedBookings.deletedCount ?? 0} booking(s) ` +
      `and ${removedPackages.deletedCount ?? 0} course package(s)`,
  })

  // Anything merged into this record would point at nothing; leave it pointing at nobody instead.
  await StudentModel.updateMany({ mergedInto: student._id }, { $set: { mergedInto: null } })

  await student.deleteOne()

  logger.info(
    { student: String(student._id), seatsFreed, bookings: removedBookings.deletedCount },
    'Student deleted',
  )

  return {
    name: student.name,
    email: student.email,
    bookingsRemoved: removedBookings.deletedCount ?? 0,
    seatsFreed,
    packagesRemoved: removedPackages.deletedCount ?? 0,
  }
}
