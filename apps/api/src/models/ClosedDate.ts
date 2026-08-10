import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * A day, or a stretch of days, the studio is shut — a holiday, or the teacher away for outside work.
 * Stored as studio-local `YYYY-MM-DD` strings so "closed on the 20th" means the whole 20th in
 * Singapore, not a 24-hour window that starts at 8am. Closed days drop out of the public calendar
 * immediately; what happens to sessions already on them is an explicit admin choice, never automatic.
 */
const closedDateSchema = new Schema(
  {
    startDate: { type: String, required: true, index: true },
    endDate: { type: String, required: true, index: true },
    reason: { type: String, default: '', maxlength: 200 },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
)

closedDateSchema.index({ startDate: 1, endDate: 1 })

export type ClosedDateDoc = HydratedDocument<InferSchemaType<typeof closedDateSchema>>
export const ClosedDateModel = model('ClosedDate', closedDateSchema)
