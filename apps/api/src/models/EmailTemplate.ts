import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * An admin-editable override for one of the built-in message templates.
 *
 * Defaults ship in code (`services/emailTemplates.ts`). A row here shadows the default, which is
 * what lets the studio reword "we look forward to seeing you" without a deploy — and lets them
 * revert by deleting the row.
 */
const emailTemplateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    bodyText: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
)

export type EmailTemplateDoc = HydratedDocument<InferSchemaType<typeof emailTemplateSchema>>
export const EmailTemplateModel = model('EmailTemplate', emailTemplateSchema)
