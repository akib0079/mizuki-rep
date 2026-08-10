import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/** A browser or installed admin PWA that has agreed to receive "someone just booked" push alerts. */
const pushSubscriptionSchema = new Schema(
  {
    adminUserId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: '' },
    lastSuccessAt: { type: Date, default: null },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export type PushSubscriptionDoc = HydratedDocument<InferSchemaType<typeof pushSubscriptionSchema>>
export const PushSubscriptionModel = model('PushSubscription', pushSubscriptionSchema)
