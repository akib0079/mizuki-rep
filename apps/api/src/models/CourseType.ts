import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * One row per course the studio teaches. This is the single place the per-course policy
 * lives — how a seat is paid for and how late a student may move it — so changing the
 * Ikebana notice period is an edit in the admin console, not a deploy.
 */
const courseTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    colour: { type: String, required: true, default: '#7c6a9c' },

    bookingMode: {
      type: String,
      enum: ['package', 'paid', 'free'],
      required: true,
      default: 'paid',
    },

    /** IFDA and Preserved Flower: 24. Ikebana and Fresh Flower: 72 (the "3 days" rule). */
    rescheduleCutoffHours: { type: Number, required: true, default: 24, min: 0 },
    cancelCutoffHours: { type: Number, required: true, default: 24, min: 0 },

    defaultDurationMins: { type: Number, required: true, default: 150, min: 15 },
    defaultCapacity: { type: Number, required: true, default: 8, min: 1 },

    /** WooCommerce products that sell a seat (or a package) for this course. */
    wooProductIds: { type: [Number], default: [] },
    /** When a Woo purchase should grant course credits rather than book one class. */
    packageGrantSessions: { type: Number, default: 0, min: 0 },
    packageValidityDays: { type: Number, default: 365, min: 0 },

    description: { type: String, default: '', maxlength: 2000 },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

courseTypeSchema.index({ wooProductIds: 1 })

export type CourseTypeDoc = HydratedDocument<InferSchemaType<typeof courseTypeSchema>>
export const CourseTypeModel = model('CourseType', courseTypeSchema)
