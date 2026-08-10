import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const breakSchema = new Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    label: { type: String, default: 'Break' },
  },
  { _id: false },
)

/**
 * One concrete class on one date — the thing students actually book.
 *
 * Sessions are materialised rows rather than values computed from ScheduleRule on read,
 * because each one accumulates state a template cannot hold: who is booked, how many
 * places are withheld, whether the studio moved it. That also means an admin can edit a
 * single Saturday without disturbing every other Saturday.
 */
const sessionSchema = new Schema(
  {
    courseTypeId: { type: Schema.Types.ObjectId, ref: 'CourseType', required: true, index: true },
    /** Null for one-off classes added by hand. */
    scheduleRuleId: { type: Schema.Types.ObjectId, ref: 'ScheduleRule', default: null, index: true },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    /** Studio-local `YYYY-MM-DD`. Denormalised so calendar grouping and closed-date matching never re-derive the zone. */
    dateKey: { type: String, required: true, index: true },

    capacity: { type: Number, required: true, min: 1 },

    /**
     * Places withheld from public sale — the admin's "minus" button — so the studio can fill
     * them from chat enquiries. Distinct from capacity: the room did not get smaller.
     */
    heldBack: { type: Number, required: true, default: 0, min: 0 },

    /**
     * Live count of seat-occupying bookings (hold, confirmed, attended).
     *
     * Only `seatService.reserveSeat`/`releaseSeat` may move this. It is denormalised so the
     * "is there room?" check is a single atomic document update rather than a count query
     * with a lost-update window between read and write. A nightly job recomputes it from
     * Bookings and alerts on drift.
     */
    seatsTaken: { type: Number, required: true, default: 0, min: 0 },

    breaks: { type: [breakSchema], default: [] },

    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled', index: true },
    title: { type: String, default: '' },
    notes: { type: String, default: '', maxlength: 2000 },

    /** Fields edited by hand on this occurrence. The generator must never overwrite these. */
    overriddenFields: { type: [String], default: [] },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true },
)

/** The public calendar's main query: scheduled classes inside a date window, in time order. */
sessionSchema.index({ status: 1, startAt: 1 })
/** Keeps rule regeneration idempotent — one session per rule per day, at that time. */
sessionSchema.index({ scheduleRuleId: 1, dateKey: 1, startAt: 1 })

export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>
export const SessionModel = model('Session', sessionSchema)
