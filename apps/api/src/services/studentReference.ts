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
