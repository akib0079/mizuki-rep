import type { Types } from 'mongoose'
import { AuditLogModel } from '../models/index.js'
import { logger } from '../logger.js'

/**
 * Record anything a student would notice: a class moved, a class size cut, credits granted,
 * a full class or a locked reschedule overridden.
 *
 * The studio is deliberately allowed to override its own rules — that flexibility is the point
 * of a custom system. Writing the override down is what keeps it safe.
 */
export async function recordAudit(entry: {
  actor: string
  actorId?: Types.ObjectId | null
  action: string
  entity: string
  entityId?: Types.ObjectId | null
  before?: unknown
  after?: unknown
  reason?: string
  ip?: string
}): Promise<void> {
  try {
    await AuditLogModel.create({
      actor: entry.actor,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? '',
      ip: entry.ip ?? '',
    })
  } catch (err) {
    // An audit failure must never take down the operation it was describing.
    logger.error({ err, action: entry.action }, 'Failed to write audit log entry')
  }
}
