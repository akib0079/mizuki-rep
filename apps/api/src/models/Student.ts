import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const studentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** The identity key. Magic links, package lookup and Woo order matching all hang off this. */
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },

    /**
     * A short label the studio can say out loud — "MZ-0042".
     *
     * Email already makes every student distinct to the system, so two people called Akib Tan
     * have always been two separate records. The problem is human: on a class register, in a
     * chat message, in a conversation about who paid, two identical names are ambiguous and the
     * only thing distinguishing them is an email address nobody wants to read aloud.
     *
     * Sparse rather than required, so existing students are not blocked from saving before the
     * backfill has reached them.
     */
    reference: { type: String, default: null, trim: true, uppercase: true },
    phone: { type: String, default: '', trim: true },

    wooCustomerId: { type: Number, default: null, index: true },

    notes: { type: String, default: '', maxlength: 4000 },
    marketingOptIn: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
)

/**
 * Mint the reference on the way in, so every path that creates a student gets one.
 *
 * A hook rather than a call at each of the four creation sites — the widget, the shop webhook,
 * and two admin routes. Those are easy to add a fifth to and forget, and a student with no
 * reference is invisible right up until someone needs to tell two identical names apart.
 *
 * `Setting` is resolved through mongoose rather than imported: importing it here would close a
 * cycle through the models barrel and back into this file.
 *
 * $inc in findOneAndUpdate is one atomic document operation, so two students registering in the
 * same instant get different numbers. Counting the collection instead would give both the same
 * one, and the unique index would then fail whichever saved second — losing a booking over a
 * cosmetic label.
 */
studentSchema.pre('save', async function assignReference(next) {
  if (this.reference) return next()

  try {
    const Setting = this.db.model('Setting')
    const row = await Setting.findOneAndUpdate(
      { key: 'student_reference_counter' },
      { $inc: { value: 1 } },
      { new: true, upsert: true },
    ).lean<{ value: unknown }>()

    const n = Number(row?.value)
    this.reference = `MZ-${String(Number.isFinite(n) && n > 0 ? n : 1).padStart(4, '0')}`
  } catch (err) {
    // A label is a convenience. Never fail a registration because it could not be minted.
    this.reference = null
  }

  next()
})

studentSchema.index({ reference: 1 }, { unique: true, sparse: true })
/** Typing a name into the console's search is the common case, so it is indexed for it. */
studentSchema.index({ name: 1 })

export type StudentDoc = HydratedDocument<InferSchemaType<typeof studentSchema>>
export const StudentModel = model('Student', studentSchema)
