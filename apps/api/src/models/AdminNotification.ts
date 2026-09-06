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

    /**
     * Who has cleared this off their own list.
     *
     * Per-admin for the same reason `readBy` is. Clearing is tidying, and one person tidying
     * their list must not take a pending approval off everybody else's — that is precisely the
     * failure this model was shaped to avoid. The row stays; it simply stops appearing for the
     * person who dismissed it, and reappears for them if they ask to see cleared items.
     */
    clearedBy: { type: [Schema.Types.ObjectId], ref: 'AdminUser', default: [], index: true },

    /** Set when the thing it was asking for actually happened. */
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: '' },

    /**
     * Stops a retried webhook or a re-run job stacking up duplicates of the same event, the same
     * way Outbox.dedupeKey does.
     *
     * No `default`, deliberately. A default of null writes the field on every row, and a *sparse*
     * unique index skips only rows where the field is missing — so every notification without a
     * key of its own collided with the last one, and `recordAdminNotification` swallows duplicate
     * keys by design. The result would have been silence: exactly one keyless notification ever
     * recorded, and every one after it dropped with nothing in the log. Both callers happen to
     * pass a key today, so this was a trap set for the third.
     */
    dedupeKey: { type: String },
  },
  { timestamps: true },
)

/**
 * Unique among the rows that actually have a key.
 *
 * A partial index rather than a sparse one: it says what it means, and it is indifferent to
 * whether a keyless row stores null or nothing at all — including the rows already written
 * before this was noticed.
 */
adminNotificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
)
/** The console's default view: newest first, unresolved actions included. */
adminNotificationSchema.index({ createdAt: -1 })

export type AdminNotificationDoc = HydratedDocument<InferSchemaType<typeof adminNotificationSchema>>
export const AdminNotificationModel = model('AdminNotification', adminNotificationSchema)
