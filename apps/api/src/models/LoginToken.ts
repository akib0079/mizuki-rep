import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * A single-use magic link for a student.
 *
 * Only the SHA-256 hash of the token is stored, so a database dump cannot be replayed into
 * anyone's account. Rows delete themselves an hour after expiry via a TTL index — expired
 * links are not evidence of anything and keeping them only widens the blast radius.
 */
const loginTokenSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    /** Where to send the student after they click, e.g. straight back to the class they were booking. */
    redirectTo: { type: String, default: '' },
    requestedIp: { type: String, default: '' },
  },
  { timestamps: true },
)

loginTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })

export type LoginTokenDoc = HydratedDocument<InferSchemaType<typeof loginTokenSchema>>
export const LoginTokenModel = model('LoginToken', loginTokenSchema)
