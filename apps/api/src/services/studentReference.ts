import { StudentModel } from '../models/index.js'
import { logger } from '../logger.js'

/**
 * Give references to students who registered before references existed.
 *
 * New students get one from the save hook on the model. This is only the catch-up pass, run at
 * startup so a studio upgrading does not have to think about it. Safe to run repeatedly: it
 * only looks at students who have no reference, and saving one is what mints it.
 */
export async function backfillReferences(): Promise<number> {
  // Oldest first, so the numbers follow the order people actually joined.
  const missing = await StudentModel.find({ reference: null }).sort({ createdAt: 1 }).limit(5000)
  if (missing.length === 0) return 0

  let assigned = 0
  for (const student of missing) {
    try {
      await student.save()
      if (student.reference) assigned++
    } catch (err) {
      logger.error({ err, studentId: String(student._id) }, 'Could not assign a student reference')
    }
  }

  logger.info({ assigned }, 'Assigned student references')
  return assigned
}

/**
 * Fill in the normalised phone for students who registered before it existed.
 *
 * Without this the duplicate-account guard silently misses every student already on file — the
 * one group it most needs to catch, because they are the people most likely to book again and
 * type their address slightly differently. Runs at startup, safe to repeat.
 */
export async function backfillPhoneDigits(): Promise<number> {
  const missing = await StudentModel.find({
    $or: [
      { phone: { $ne: '' }, phoneDigits: '' },
      { phoneDigits: { $exists: false } },
      { nameNormalised: '' },
      { nameNormalised: { $exists: false } },
    ],
  }).limit(5000)

  if (missing.length === 0) return 0

  let filled = 0
  for (const student of missing) {
    try {
      // Assigned directly rather than relying on the save hook, which only fires when `phone`
      // itself changed — and here it has not.
      student.phoneDigits = (student.phone ?? '').replace(/\D/g, '')
      student.nameNormalised = (student.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      await student.save()
      filled++
    } catch (err) {
      logger.error({ err, studentId: String(student._id) }, 'Could not normalise a student phone number')
    }
  }

  logger.info({ filled }, 'Normalised student names and phone numbers')
  return filled
}
