import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * Who changed what. Written for anything with consequences a student would notice:
 * moving a class, shrinking capacity, granting course credits, overriding a full class
 * or a locked reschedule. This is what makes "the studio can always override the rules"
 * safe to offer — an override is recorded, not invisible.
 */
const auditLogSchema = new Schema(
  {
    actor: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, default: null, index: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

auditLogSchema.index({ createdAt: -1 })

export type AuditLogDoc = HydratedDocument<InferSchemaType<typeof auditLogSchema>>
export const AuditLogModel = model('AuditLog', auditLogSchema)
