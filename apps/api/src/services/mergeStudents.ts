import type { Types } from 'mongoose'
import { BookingModel, PackageModel, StudentModel } from '../models/index.js'
import { AppError, NotFoundError } from '../errors.js'
import { recordAudit } from './auditService.js'
import { logger } from '../logger.js'

/**
 * Join two accounts that turned out to be the same person.
 *
 * Detection stops new duplicates; it cannot undo the ones already made. The studio has students
 * spread across three accounts with three separate course balances, and no amount of typing in
 * the console fixes that — the bookings, the credits and the history all have to move together.
 *
 * Nothing is deleted. The account being merged away is kept, emptied and marked, because it is
 * referenced by audit entries and by whatever the studio remembers, and a row that vanishes is a
 * row nobody can check afterwards.
 */

export interface MergeResult {
  bookingsMoved: number
  packagesMoved: number
  keptId: string
  mergedId: string
}

export async function mergeStudents(
  keepId: Types.ObjectId | string,
  mergeId: Types.ObjectId | string,
  actor: string,
): Promise<MergeResult> {
  if (String(keepId) === String(mergeId)) {
    throw new AppError(400, 'same_student', 'Those are the same student.')
  }

  const [keep, merge] = await Promise.all([
    StudentModel.findById(keepId),
    StudentModel.findById(mergeId),
  ])
  if (!keep) throw new NotFoundError('Student to keep')
  if (!merge) throw new NotFoundError('Student to merge')

  if (merge.mergedInto) {
    throw new AppError(400, 'already_merged', 'That account has already been merged into another.')
  }

  /*
   * A student cannot hold two live places in the same class — there is a unique index saying so.
   * Moving a booking into a class the kept account is already in would break it, so those are
   * left where they are and reported rather than moved: one of them is a genuine duplicate
   * booking and only the studio can say which.
   */
  const mergeBookings = await BookingModel.find({ studentId: merge._id }).lean()
  const keepSessionIds = new Set(
    (await BookingModel.find({ studentId: keep._id }).select('sessionId').lean()).map((b) =>
      String(b.sessionId),
    ),
  )

  const movable = mergeBookings.filter((b) => !keepSessionIds.has(String(b.sessionId)))

  const bookings = await BookingModel.updateMany(
    { _id: { $in: movable.map((b) => b._id) } },
    { $set: { studentId: keep._id } },
  )

  const packages = await PackageModel.updateMany(
    { studentId: merge._id },
    { $set: { studentId: keep._id } },
  )

  /*
   * Anything the kept record is missing, take from the one being merged away — a phone number on
   * one and not the other is the usual case, and losing it would make the merge a downgrade.
   */
  if (!keep.phone && merge.phone) keep.phone = merge.phone
  if (merge.notes) keep.notes = [keep.notes, merge.notes].filter(Boolean).join('\n')
  keep.marketingOptIn = keep.marketingOptIn || merge.marketingOptIn
  await keep.save()

  /*
   * The email is freed so it cannot collide, and so the studio can see at a glance that this row
   * is a tombstone rather than a person. Kept, not deleted: audit entries point at it.
   */
  merge.email = `merged+${merge._id}@mizuki.invalid`
  merge.phone = ''
  merge.phoneDigits = ''
  merge.mergedInto = keep._id
  await merge.save()

  await recordAudit({
    actor,
    action: 'student.merge',
    entity: 'Student',
    entityId: keep._id,
    reason: `Merged ${merge.name} into ${keep.name}`,
    after: {
      bookingsMoved: bookings.modifiedCount,
      packagesMoved: packages.modifiedCount,
      leftBehind: mergeBookings.length - movable.length,
    },
  })

  if (mergeBookings.length !== movable.length) {
    logger.warn(
      { keepId: String(keep._id), mergeId: String(merge._id), left: mergeBookings.length - movable.length },
      'Some bookings were left behind: the kept student is already in those classes',
    )
  }

  return {
    bookingsMoved: bookings.modifiedCount,
    packagesMoved: packages.modifiedCount,
    keptId: String(keep._id),
    mergedId: String(merge._id),
  }
}

/**
 * Accounts that look like they belong to the same person.
 *
 * Grouped so the studio sees "these three are probably one student" rather than a list of every
 * pair, which for a few hundred students is unreadable.
 */
export async function findDuplicateGroups(): Promise<
  { reason: string; students: { id: string; reference: string; name: string; email: string; phone: string }[] }[]
> {
  const students = await StudentModel.find({ mergedInto: null }).sort({ createdAt: 1 }).limit(2000).lean()

  const groups: { reason: string; members: typeof students }[] = []
  const claimed = new Set<string>()

  const { emailsLookAlike, normaliseName } = await import('./studentMatch.js')

  for (const a of students) {
    if (claimed.has(String(a._id))) continue

    const members = students.filter(
      (b) =>
        String(b._id) !== String(a._id) &&
        !claimed.has(String(b._id)) &&
        (emailsLookAlike(a.email, b.email) ||
          (a.phoneDigits && a.phoneDigits === b.phoneDigits) ||
          (a.name && normaliseName(a.name) === normaliseName(b.name))),
    )

    if (members.length === 0) continue

    for (const m of [a, ...members]) claimed.add(String(m._id))

    const reason = members.some((b) => emailsLookAlike(a.email, b.email))
      ? 'Their email addresses are nearly identical'
      : members.some((b) => a.phoneDigits && a.phoneDigits === b.phoneDigits)
        ? 'They share a phone number'
        : 'They have the same name'

    groups.push({ reason, members: [a, ...members] })
  }

  return groups.map((g) => ({
    reason: g.reason,
    students: g.members.map((s) => ({
      id: String(s._id),
      reference: s.reference ?? '',
      name: s.name,
      email: s.email,
      phone: s.phone,
    })),
  }))
}
