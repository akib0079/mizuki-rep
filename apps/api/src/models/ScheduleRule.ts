import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const breakSchema = new Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    label: { type: String, default: 'Break' },
  },
  { _id: false },
)

/** Declared as its own schema so the shape is required and non-nullable once loaded. */
const recurrenceSchema = new Schema(
  {
    freq: { type: String, enum: ['WEEKLY', 'NONE'], required: true, default: 'WEEKLY' },
    /** ISO weekdays: 1 = Monday … 7 = Sunday. */
    byWeekday: { type: [Number], required: true, default: [] },
    interval: { type: Number, required: true, default: 1, min: 1 },
  },
  { _id: false },
)

/**
 * A repeating slot in the weekly timetable — "IFDA, Tuesdays and Wednesdays, 10:00, three hours".
 * Rules do not get booked; the generator turns them into concrete Sessions, which do.
 * Deactivating a rule stops future generation but leaves already-generated classes alone,
 * so a student's booking never vanishes because the studio edited a template.
 */
const scheduleRuleSchema = new Schema(
  {
    courseTypeId: { type: Schema.Types.ObjectId, ref: 'CourseType', required: true, index: true },
    title: { type: String, required: true, trim: true },

    recurrence: { type: recurrenceSchema, required: true },

    /** Studio-local wall clock. Stored as text so a rule keeps meaning "10am" regardless of zone maths. */
    startTime: { type: String, required: true },
    durationMins: { type: Number, required: true, min: 15 },
    capacity: { type: Number, required: true, min: 1 },
    breaks: { type: [breakSchema], default: [] },

    effectiveFrom: { type: String, required: true },
    effectiveTo: { type: String, default: null },

    active: { type: Boolean, default: true, index: true },

    /**
     * Occurrences of this rule that should not exist — the calendar's version of an EXDATE.
     *
     * The generator decides what to create by asking which slots have no session row yet, so
     * deleting a class that came from a weekly rule is undone by the next tick five minutes
     * later. The studio would delete it, watch it reappear, and reasonably conclude the button
     * does not work. Each entry is the exact start instant that was deleted, so the rule keeps
     * running and only that one date stays gone.
     */
    exceptions: { type: [Schema.Types.Date], default: [] },
  },
  { timestamps: true },
)

scheduleRuleSchema.index({ active: 1, effectiveFrom: 1, effectiveTo: 1 })

export type ScheduleRuleDoc = HydratedDocument<InferSchemaType<typeof scheduleRuleSchema>>
export const ScheduleRuleModel = model('ScheduleRule', scheduleRuleSchema)
