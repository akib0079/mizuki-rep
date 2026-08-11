import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * Something the studio should see when they next open the console.
 *
 * Separate from Outbox, which is a delivery queue: a row there is a message on its way out and
 * is finished once it sends. This is a record of something that happened, which stays until
 * someone has actually looked at it. The distinction matters because email is exactly what the
 * studio told us they miss — a place awaiting payment approval cannot depend on an inbox.
 */
const adminNotificationSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        'new_booking',
        'awaiting_confirmation',
        'booking_cancelled',
        'booking_rescheduled',
        'paid_but_full',
        'session_over_capacity',
      ],
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },

    /**
     * `action` means someone has to do something before this goes away — approving a paid place,
     * refunding a student who paid for a class that filled. Those stay visible until resolved
     * rather than being cleared by a glance at the list.
     */
    severity: { type: String, enum: ['info', 'action'], default: 'info', index: true },

    /** Where the console should go when this is clicked. */
    url: { type: String, default: '' },

    relatedBookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    relatedSessionId: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
    relatedStudentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },

    /**
     * Read is per-admin, not a single flag: with several people sharing the console, one of them
     * opening the list must not hide a pending approval from everyone else.
     */
    readBy: { type: [Schema.Types.ObjectId], ref: 'AdminUser', default: [], index: true },

    /** Set when the thing it was asking for actually happened. */
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: '' },

    /**
     * Stops a retried webhook or a re-run job stacking up duplicates of the same event, the same
     * way Outbox.dedupeKey does. Sparse, because plenty of notifications are one-offs.
     */
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true },
)

adminNotificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true })
/** The console's default view: newest first, unresolved actions included. */
adminNotificationSchema.index({ createdAt: -1 })

export type AdminNotificationDoc = HydratedDocument<InferSchemaType<typeof adminNotificationSchema>>
export const AdminNotificationModel = model('AdminNotification', adminNotificationSchema)
