import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'
import { ACTIVE_BOOKING_STATUSES } from '@mizuki/shared'

/**
 * One student in one class.
 *
 * `hold` is the state a booking sits in while the student is inside WooCommerce checkout:
 * it occupies a place exactly like a confirmed booking, so the last seat cannot be sold
 * twice, but it expires on its own if payment never arrives.
 */
const bookingSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },

    status: {
      type: String,
      enum: ['hold', 'awaiting_confirmation', 'confirmed', 'cancelled', 'attended', 'no_show'],
      required: true,
      default: 'confirmed',
      index: true,
    },
    source: {
      type: String,
      enum: ['student_web', 'admin_manual', 'woo_order'],
      required: true,
      default: 'student_web',
    },

    /** Set when the seat was paid for with a course credit, so cancelling can hand it back. */
    packageId: { type: Schema.Types.ObjectId, ref: 'Package', default: null, index: true },

    wooOrderId: { type: Number, default: null, index: true },
    holdToken: { type: String, default: null, index: true },
    holdExpiresAt: { type: Date, default: null },

    /** Set on the new booking when a student moves, so the studio can see the history. */
    rescheduledFrom: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },

    studentNotes: { type: String, default: '', maxlength: 500 },
    adminNotes: { type: String, default: '', maxlength: 2000 },

    /** Recorded so a capacity override is always visible after the fact, never silent. */
    capacityOverridden: { type: Boolean, default: false },

    confirmedAt: { type: Date, default: null },
    /** Stamped by the reminder job so the studio can see a reminder went, and when. */
    confirmationSentAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
    cancelledBy: { type: String, default: '' },

    /**
     * True when this booking was cancelled *because the class was*, rather than by the student
     * or the studio removing one person. Undoing a cancelled class restores exactly these, so
     * someone who had already dropped out is not silently put back in.
     *
     * A flag rather than a reading of `cancelReason`: the studio types that field freely, and
     * inferring intent from prose means undo quietly stops working the day they word it
     * differently.
     */
    cancelledWithSession: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
)

/**
 * A student cannot hold two live places in the same class. Partial, so the same student
 * may rebook a class they previously cancelled — the cancelled row stays for history.
 *
 * The filter is built from the shared constant rather than written out, so a new live status is
 * covered here the moment it is added. Getting this wrong is silent: the index would simply stop
 * applying to the new status and let one student take two places. `syncIndexes()` at startup
 * drops and rebuilds the index when this expression changes, so a deploy is enough.
 */
bookingSchema.index(
  { sessionId: 1, studentId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: [...ACTIVE_BOOKING_STATUSES] } },
    name: 'one_live_booking_per_student_per_session',
  },
)

/** Drives the hold sweeper. */
bookingSchema.index({ status: 1, holdExpiresAt: 1 })
/** Drives the 2-day reminder scan and the student's upcoming-classes list. */
bookingSchema.index({ studentId: 1, status: 1, createdAt: -1 })

export type BookingDoc = HydratedDocument<InferSchemaType<typeof bookingSchema>>
export const BookingModel = model('Booking', bookingSchema)
