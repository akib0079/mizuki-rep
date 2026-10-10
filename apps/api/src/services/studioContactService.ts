import { config } from '../config.js'
import { SettingModel, SETTING_KEYS } from '../models/index.js'
import { PLAIN_KEYS, setPlain } from './secretStore.js'

export interface StudioContact {
  name: string
  address: string
  phone: string
  email: string
}

export const DEFAULT_STUDIO_CONTACT: StudioContact = {
  name: 'Mizuki Flora',
  address: '#2/F, 148 Jalan Besar, Singapore 208866',
  phone: config.STUDIO_PHONE,
  email: config.MAIL_REPLY_TO || config.STUDIO_EMAIL,
}

const KEYS = {
  name: SETTING_KEYS.studioName,
  address: SETTING_KEYS.studioAddress,
  phone: SETTING_KEYS.studioPhone,
  email: SETTING_KEYS.studioEmail,
} as const

export async function getStudioContact(): Promise<StudioContact> {
  const rows = await SettingModel.find({ key: { $in: [...Object.values(KEYS), PLAIN_KEYS.mailReplyTo] } }).lean()
  const values = new Map(rows.map((row) => [row.key, String(row.value)]))
  return {
    name: values.get(KEYS.name) || DEFAULT_STUDIO_CONTACT.name,
    address: values.get(KEYS.address) || DEFAULT_STUDIO_CONTACT.address,
    phone: values.get(KEYS.phone) || DEFAULT_STUDIO_CONTACT.phone,
    email: values.get(KEYS.email) || values.get(PLAIN_KEYS.mailReplyTo) || DEFAULT_STUDIO_CONTACT.email,
  }
}

export async function saveStudioContact(contact: StudioContact, by: string): Promise<void> {
  await Promise.all((Object.keys(KEYS) as (keyof StudioContact)[]).map((field) =>
    SettingModel.findOneAndUpdate(
      { key: KEYS[field] },
      { $set: { value: contact[field], updatedBy: by } },
      { upsert: true },
    ),
  ))
  await setPlain(PLAIN_KEYS.mailReplyTo, contact.email, by)
}

export function sessionVenueAddress(session: { venueAddress?: string | null }, studio: StudioContact): string {
  return session.venueAddress?.trim() || studio.address
}
