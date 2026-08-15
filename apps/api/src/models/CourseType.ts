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

    /**
     * Give this course its own section in the console, instead of mixing it into the rest.
     *
     * IFDA is the reason this exists. It is not one more workshop: it runs three times a week
     * all year, it is bought as a block of sessions rather than a ticket, and its students are
     * enrolled for months. On the shared dashboard it drowned everything else — 121 of 139
     * classes — so the studio could not see the workshops at all, and the thing it actually
     * needed to track about IFDA (who is enrolled, how many sessions they have left) was not
     * on that dashboard in the first place.
     *
     * A flag rather than a hardcoded slug: the studio can move another course in or out of its
     * own section from the settings page, without anyone editing code.
     */
    managedSeparately: { type: Boolean, default: false },

    /** WooCommerce products that sell a seat (or a package) for this course. */
    wooProductIds: { type: [Number], default: [] },

    /**
     * When true, a paid place is not confirmed by the payment alone — it waits in
     * `awaiting_confirmation` until the studio has checked the money actually arrived and
     * approved it. The place is held throughout, so nobody else can take it.
     *
     * This exists because the studio reconciles some payments by hand against their bank rather
     * than trusting the shop's status, and a place confirmed automatically is one they would
     * have to chase and cancel afterwards.
     */
    requiresManualConfirmation: { type: Boolean, default: false },
    /** When a Woo purchase should grant course credits rather than book one class. */
    packageGrantSessions: { type: Number, default: 0, min: 0 },
    packageValidityDays: { type: Number, default: 365, min: 0 },

    /*
     * What a student reads before deciding.
     *
     * Everything below is shown on the booking page behind "Learn more", and every field is
     * optional — a course with none of it filled in simply shows no button, rather than opening a
     * panel of empty headings. The studio writes these once and the same words then appear
     * wherever the course does, instead of being retyped into a product description each time.
     */
    description: { type: String, default: '', maxlength: 2000 },
    /** Who it suits — beginners, people continuing from a trial, and so on. */
    suitableFor: { type: String, default: '', maxlength: 600 },
    /** What the class covers. */
    whatYouLearn: { type: String, default: '', maxlength: 2000 },
    /** What the student needs to bring. */
    whatToBring: { type: String, default: '', maxlength: 600 },
    /** What the studio supplies — flowers, tools, refreshments. */
    whatIsProvided: { type: String, default: '', maxlength: 600 },
    /** Free text rather than a number: prices here are per class, per package, and per trial. */
    priceNote: { type: String, default: '', maxlength: 300 },
    /** A photograph of the work, shown at the top of the panel. */
    imageUrl: { type: String, default: '', maxlength: 500 },

    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

courseTypeSchema.index({ wooProductIds: 1 })

export type CourseTypeDoc = HydratedDocument<InferSchemaType<typeof courseTypeSchema>>
export const CourseTypeModel = model('CourseType', courseTypeSchema)
