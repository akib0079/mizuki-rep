import { Types, type ClientSession } from 'mongoose'
import { evaluatePackageUsable, sessionsRemaining } from '@mizuki/shared'
import { PackageModel, type PackageDoc } from '../models/index.js'
import { AppError, NotFoundError, ruleError } from '../errors.js'
import { logger } from '../logger.js'

/**
 * Course credits for IFDA and Preserved Flower — "students' sessions are counted down as they book".
 *
 * Credits are spent with the same conditional-update trick the seat counter uses, so a student
 * cannot spend their last session twice by double-clicking. Every movement is also appended to
 * the package ledger, because the studio grants extra sessions and extends expiry by hand and
 * "why does this say 3 when I bought 8" needs an answer.
 */

/** The package a student should spend for this course — the one expiring soonest, so nothing is wasted. */
export async function findUsablePackage(
  studentId: Types.ObjectId | string,
  courseTypeId: Types.ObjectId | string,
  now: Date = new Date(),
): Promise<PackageDoc | null> {
  const candidates = await PackageModel.find({
    studentId,
    courseTypeId,
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).sort({ expiresAt: 1 })

  return candidates.find((pkg) => sessionsRemaining(pkg) > 0) ?? null
}

/** Mongoose infers `Date | null | undefined` for a nullable date; the domain type wants `Date | null`. */
function normaliseExpiry(value: Date | null | undefined): Date | null {
  return value ?? null
}

/**
 * Spend one credit. Atomic: the "has a session left" test lives in the update filter, so two
 * concurrent bookings cannot both consume the final session.
 */
export async function consumeSession(
  packageId: Types.ObjectId | string,
  opts: { bookingId?: Types.ObjectId | null; by?: string; note?: string; session?: ClientSession | null } = {},
): Promise<PackageDoc> {
  const { bookingId = null, by = 'system', note = '', session = null } = opts

  const updated = await PackageModel.findOneAndUpdate(
    {
      _id: packageId,
      status: 'active',
      $expr: { $lt: ['$usedSessions', '$totalSessions'] },
    },
    {
      $inc: { usedSessions: 1 },
      $push: { ledger: { type: 'consume', delta: -1, bookingId, note, at: new Date(), by } },
    },
    { new: true, session },
  )

  if (!updated) {
    const existing = await PackageModel.findById(packageId).session(session)
    if (!existing) throw new NotFoundError('Course package')
    const verdict = evaluatePackageUsable(
      { ...existing.toObject(), courseTypeId: String(existing.courseTypeId), expiresAt: normaliseExpiry(existing.expiresAt) },
      String(existing.courseTypeId),
      new Date(),
    )
    throw ruleError(verdict.code, verdict.message || 'This course package has no sessions left.')
  }

  // Mark a fully-spent package so it stops appearing as bookable, without deleting the history.
  if (sessionsRemaining(updated) === 0) {
    updated.status = 'completed'
    await updated.save({ session: session ?? undefined })
  }

  return updated
}

/** Hand a credit back when a booking is cancelled, or when a reschedule fails after consuming one. */
export async function restoreSession(
  packageId: Types.ObjectId | string,
  opts: { bookingId?: Types.ObjectId | null; by?: string; note?: string; session?: ClientSession | null } = {},
): Promise<void> {
  const { bookingId = null, by = 'system', note = '', session = null } = opts

  const updated = await PackageModel.findOneAndUpdate(
    { _id: packageId, usedSessions: { $gt: 0 } },
    {
      $inc: { usedSessions: -1 },
      $push: { ledger: { type: 'refund', delta: 1, bookingId, note, at: new Date(), by } },
      // A package that had been spent in full becomes usable again.
      $set: { status: 'active' },
    },
    { new: true, session },
  )

  if (!updated) {
    logger.warn({ packageId: String(packageId) }, 'restoreSession found no consumed session to return')
  }
}

/** "You can see what's left and add more sessions or more time whenever a student needs it." */
export async function grantSessions(input: {
  studentId: Types.ObjectId | string
  courseTypeId: Types.ObjectId | string
  totalSessions: number
  expiresAt?: Date | null
  note?: string
  by?: string
  sourceOrderId?: number | null
}): Promise<PackageDoc> {
  return PackageModel.create({
    studentId: input.studentId,
    courseTypeId: input.courseTypeId,
    totalSessions: input.totalSessions,
    usedSessions: 0,
    expiresAt: input.expiresAt ?? null,
    status: 'active',
    sourceOrderId: input.sourceOrderId ?? null,
    note: input.note ?? '',
    ledger: [
      {
        type: 'grant',
        delta: input.totalSessions,
        bookingId: null,
        note: input.note ?? 'Package created',
        at: new Date(),
        by: input.by ?? 'admin',
      },
    ],
  })
}

/** Add sessions to an existing package, extend its expiry, or both. */
export async function adjustPackage(
  packageId: Types.ObjectId | string,
  input: { addSessions?: number; extendToDate?: Date | null; note?: string; by?: string },
): Promise<PackageDoc> {
  const pkg = await PackageModel.findById(packageId)
  if (!pkg) throw new NotFoundError('Course package')

  const by = input.by ?? 'admin'
  const note = input.note ?? ''

  if (input.addSessions) {
    const next = pkg.totalSessions + input.addSessions
    if (next < pkg.usedSessions) {
      throw new AppError(
        422,
        'below_used',
        `This student has already attended ${pkg.usedSessions} sessions, so the total cannot be reduced to ${next}.`,
      )
    }
    pkg.totalSessions = next
    pkg.ledger.push({ type: 'adjust', delta: input.addSessions, bookingId: null, note, at: new Date(), by })
  }

  if (input.extendToDate !== undefined && input.extendToDate !== null) {
    pkg.expiresAt = input.extendToDate
    pkg.ledger.push({ type: 'extend', delta: 0, bookingId: null, note: note || 'Expiry extended', at: new Date(), by })
    // Reopening the window revives a package the expiry sweeper had already closed.
    if (pkg.status === 'expired') pkg.status = 'active'
  }

  if (pkg.status === 'completed' && sessionsRemaining(pkg) > 0) pkg.status = 'active'
  pkg.lowBalanceNotifiedAt = null

  await pkg.save()
  return pkg
}

export interface PackageSummary {
  id: string
  courseTypeId: string
  totalSessions: number
  usedSessions: number
  remaining: number
  expiresAt: Date | null
  status: string
}

export async function summarisePackages(studentId: Types.ObjectId | string): Promise<PackageSummary[]> {
  const packages = await PackageModel.find({ studentId }).sort({ createdAt: -1 }).lean()
  return packages.map((p) => ({
    id: String(p._id),
    courseTypeId: String(p.courseTypeId),
    totalSessions: p.totalSessions,
    usedSessions: p.usedSessions,
    remaining: Math.max(0, p.totalSessions - p.usedSessions),
    expiresAt: normaliseExpiry(p.expiresAt),
    status: p.status,
  }))
}
