import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * Every outbound message — student email, admin alert, Telegram push — is written here first.
 *
 * The unique `dedupeKey` is the whole point. Cron fires every five minutes and jobs are retried
 * on failure, so without it a student would get the same "your class is in 2 days" reminder a
 * dozen times. Claiming a row is a conditional update, so two overlapping cron runs cannot both
 * send the same message.
 */
const outboxSchema = new Schema(
  {
    /** e.g. `booking_confirmation`, `reminder_2day`, `admin_new_booking`. */
    type: { type: String, required: true, index: true },
    channel: { type: String, enum: ['email', 'telegram', 'webpush'], required: true, default: 'email' },

    /** Stable identity for this exact message, e.g. `reminder_2day:<bookingId>`. */
    dedupeKey: { type: String, required: true, unique: true },

    to: { type: String, default: '' },
    subject: { type: String, default: '' },
    bodyHtml: { type: String, default: '' },
    bodyText: { type: String, default: '' },
    payload: { type: Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ['pending', 'sending', 'sent', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    /** Earliest the sender may pick this up — used to back off after a failure. */
    availableAt: { type: Date, default: () => new Date(), index: true },
    sentAt: { type: Date, default: null },

    relatedBookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    relatedSessionId: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
  },
  { timestamps: true },
)

outboxSchema.index({ status: 1, availableAt: 1 })

export type OutboxDoc = HydratedDocument<InferSchemaType<typeof outboxSchema>>
export const OutboxModel = model('Outbox', outboxSchema)
