import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const studentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** The identity key. Magic links, package lookup and Woo order matching all hang off this. */
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },

    wooCustomerId: { type: Number, default: null, index: true },

    notes: { type: String, default: '', maxlength: 4000 },
    marketingOptIn: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type StudentDoc = HydratedDocument<InferSchemaType<typeof studentSchema>>
export const StudentModel = model('Student', studentSchema)
