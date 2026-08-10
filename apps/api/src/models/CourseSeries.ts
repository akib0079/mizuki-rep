import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * A fixed run of classes sold as one thing — the studio's "Autumn Ikebana Course", four
 * consecutive mornings on 12 and 26 September and 10 and 24 October.
 *
 * The distinction from a course package matters. A package is a wallet of credits the student
 * spends on whatever dates suit them. A series is a set course: buying it means attending
 * those specific dates, in order, because each session builds on the last. So one purchase
 * books every date at once — and either all of them are secured or none are, since a student
 * holding days one, two and four of a four-day course has bought something useless.
 */
const courseSeriesSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    courseTypeId: { type: Schema.Types.ObjectId, ref: 'CourseType', required: true, index: true },

    /** The classes that make up the course, in the order they run. */
    sessionIds: { type: [Schema.Types.ObjectId], ref: 'Session', required: true, default: [] },

    /** The shop product that sells this course. */
    wooProductId: { type: Number, default: null, index: true },

    description: { type: String, default: '', maxlength: 2000 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

export type CourseSeriesDoc = HydratedDocument<InferSchemaType<typeof courseSeriesSchema>>
export const CourseSeriesModel = model('CourseSeries', courseSeriesSchema)
