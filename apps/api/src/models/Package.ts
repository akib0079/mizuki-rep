import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const ledgerEntrySchema = new Schema(
  {
    type: { type: String, enum: ['grant', 'consume', 'refund', 'adjust', 'extend'], required: true },
    delta: { type: Number, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    note: { type: String, default: '' },
    at: { type: Date, required: true, default: () => new Date() },
    by: { type: String, default: 'system' },
  },
  { _id: false },
)

/**
 * A block of pre-bought sessions for IFDA or Preserved Flower, counted down as the student books.
 *
 * Every movement is appended to `ledger` rather than only mutating `usedSessions`, because the
 * studio grants extra sessions and extends expiry by hand — and when a balance later looks wrong,
 * "who changed this and why" needs an answer. `usedSessions` is the fast read; the ledger is the truth.
 */
const packageSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    courseTypeId: { type: Schema.Types.ObjectId, ref: 'CourseType', required: true, index: true },

    totalSessions: { type: Number, required: true, min: 0 },
    usedSessions: { type: Number, required: true, default: 0, min: 0 },

    expiresAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'expired', 'completed'], default: 'active', index: true },

    sourceOrderId: { type: Number, default: null },
    note: { type: String, default: '', maxlength: 1000 },

    ledger: { type: [ledgerEntrySchema], default: [] },

    /** Set when the "your package is running low" email went out, so it only sends once. */
    lowBalanceNotifiedAt: { type: Date, default: null },
    expiryNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

packageSchema.index({ studentId: 1, courseTypeId: 1, status: 1 })
packageSchema.index({ status: 1, expiresAt: 1 })

export type PackageDoc = HydratedDocument<InferSchemaType<typeof packageSchema>>
export const PackageModel = model('Package', packageSchema)
