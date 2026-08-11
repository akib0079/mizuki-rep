import crypto from 'node:crypto'
import { SettingModel } from '../models/index.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Secrets the studio can change themselves, without a redeploy.
 *
 * An API key in the database is a step down from one in the environment, so three things make it
 * acceptable: it is encrypted at rest, so a database dump — or one of our own nightly backups —
 * does not hand it over; it is never sent back to the browser, only a masked hint; and the
 * environment variable stays the default, so a studio that never touches this screen is exactly
 * as they were.
 *
 * Encryption is AES-256-GCM under a key derived from JWT_SECRET. That ties the ciphertext to the
 * deployment: rotating JWT_SECRET makes stored secrets unreadable, which is the correct
 * behaviour — it fails closed and falls back to the environment rather than silently using a
 * key an attacker may have planted.
 */

const ALGORITHM = 'aes-256-gcm'
/** Fixed salt: the derived key must be stable across restarts, and JWT_SECRET is the real secret. */
const SALT = 'mizuki.secret.store.v1'

function encryptionKey(): Buffer {
  return crypto.scryptSync(config.JWT_SECRET, SALT, 32)
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.')
}

export function decryptSecret(stored: string): string | null {
  try {
    const [ivPart, tagPart, dataPart] = stored.split('.')
    if (!ivPart || !tagPart || !dataPart) return null

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, 'base64'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // Wrong key, or tampered ciphertext. Fail closed — the caller falls back to the environment.
    return null
  }
}

export const SECRET_KEYS = {
  resendApiKey: 'secret.resendApiKey',
  telegramBotToken: 'secret.telegramBotToken',
  telegramChatId: 'secret.telegramChatId',
} as const

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS]

/**
 * Read a secret: the studio's stored value if there is one, otherwise the environment.
 *
 * Cached for a minute so sending a batch of emails does not mean a database read per message,
 * and cleared immediately on write so a corrected key takes effect on the next send rather than
 * a minute later — which is exactly when someone is watching to see if it worked.
 */
const cache = new Map<string, { value: string | null; until: number }>()
const CACHE_MS = 60_000

export async function getSecret(key: SecretKey, envFallback?: string): Promise<string | null> {
  const cached = cache.get(key)
  if (cached && cached.until > Date.now()) return cached.value ?? envFallback ?? null

  const row = await SettingModel.findOne({ key }).lean()
  const value = row?.value ? decryptSecret(String(row.value)) : null

  cache.set(key, { value, until: Date.now() + CACHE_MS })
  return value ?? envFallback ?? null
}

export async function setSecret(key: SecretKey, plaintext: string, by: string): Promise<void> {
  await SettingModel.findOneAndUpdate(
    { key },
    { $set: { value: encryptSecret(plaintext), updatedBy: by } },
    { upsert: true },
  )
  cache.delete(key)
  logger.info({ key, by }, 'Stored secret updated')
}

export async function clearSecret(key: SecretKey, by: string): Promise<void> {
  await SettingModel.deleteOne({ key })
  cache.delete(key)
  logger.info({ key, by }, 'Stored secret cleared — falling back to environment')
}

export function clearSecretCache(): void {
  cache.clear()
}

export interface SecretStatus {
  configured: boolean
  /** Enough to recognise the key, never enough to use it. */
  hint: string
  source: 'studio' | 'environment' | 'none'
}

/**
 * What the console is allowed to see.
 *
 * Deliberately never the value. A masked hint answers "is the right key in there?" — which is
 * the only question the screen needs to answer — without the screen becoming a way to read a
 * secret back out.
 */
export async function describeSecret(key: SecretKey, envFallback?: string): Promise<SecretStatus> {
  const row = await SettingModel.findOne({ key }).lean()
  const stored = row?.value ? decryptSecret(String(row.value)) : null
  const value = stored ?? envFallback ?? null

  if (!value) return { configured: false, hint: '', source: 'none' }

  return {
    configured: true,
    hint: value.length <= 12 ? `${value.slice(0, 2)}…` : `${value.slice(0, 6)}…${value.slice(-4)}`,
    source: stored ? 'studio' : 'environment',
  }
}
