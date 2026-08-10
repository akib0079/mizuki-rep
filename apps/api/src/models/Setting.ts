import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/** Studio-wide config the admin can change without a deploy. One row per key. */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
)

export type SettingDoc = HydratedDocument<InferSchemaType<typeof settingSchema>>
export const SettingModel = model('Setting', settingSchema)

export const SETTING_KEYS = {
  studioName: 'studio.name',
  studioAddress: 'studio.address',
  studioPhone: 'studio.phone',
  notifyAdminOnBooking: 'notifications.adminOnBooking',
  reminderLeadDays: 'notifications.reminderLeadDays',
} as const
