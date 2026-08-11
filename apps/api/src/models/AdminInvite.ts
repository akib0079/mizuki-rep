import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * A single-use link that lets a new admin set their own password.
 *
 * Only the SHA-256 hash is stored, so a database dump cannot be replayed into an account with
 * full rights over the studio's bookings. The link is shown once, to the person creating the
 * invite, and never again.
 *
 * Deliberately not "here is the password I chose for you, sent by email": that puts a working
 * credential in two inboxes permanently, and it is also the one thing that cannot work right
 * now — the studio is sending through Resend's sandbox, which only delivers to the account
 * owner. A link the creator copies and hands over works regardless of what email can reach.
 */
const adminInviteSchema = new Schema(
  {
    adminUserId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    invitedBy: { type: String, default: '' },
  },
  { timestamps: true },
)

/** Cleared an hour after expiry — an expired invite is not evidence of anything. */
adminInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })

export type AdminInviteDoc = HydratedDocument<InferSchemaType<typeof adminInviteSchema>>
export const AdminInviteModel = model('AdminInvite', adminInviteSchema)
