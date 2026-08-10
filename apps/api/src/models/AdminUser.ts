import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const adminUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    /** Argon2id hash. Never selected by default so it cannot leak through a stray `.find()`. */
    passwordHash: { type: String, required: true, select: false },

    /** Base32 TOTP secret, set once during 2FA enrolment. */
    totpSecret: { type: String, default: null, select: false },
    totpEnabled: { type: Boolean, default: false },

    role: { type: String, enum: ['owner', 'staff'], default: 'staff' },
    active: { type: Boolean, default: true },

    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    /** Bumped to invalidate every issued session for this user at once. */
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export type AdminUserDoc = HydratedDocument<InferSchemaType<typeof adminUserSchema>>
export const AdminUserModel = model('AdminUser', adminUserSchema)
