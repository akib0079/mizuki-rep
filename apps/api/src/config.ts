import 'dotenv/config'
import { z } from 'zod'

/**
 * Fail loudly at boot rather than at 2am when a reminder job needs a key that was never set.
 * Hostinger's Node app panel injects these as environment variables.
 */
/**
 * Environment variables are strings, and `z.coerce.boolean()` follows JavaScript's rule that any
 * non-empty string is true — so SCHEDULER_ENABLED=false would enable it. This reads the words
 * people actually write instead.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    return !['false', '0', 'no', 'off', ''].includes(value.trim().toLowerCase())
  })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (MongoDB Atlas connection string)'),

  /** Signs admin and student sessions. Rotating it logs everybody out, which is the intended emergency lever. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Guards POST /jobs/tick so only the hPanel cron can run scheduled work. */
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  /** Shared with the WordPress plugin to sign WooCommerce order webhooks. */
  WOO_WEBHOOK_SECRET: z.string().min(16).optional(),

  /** Public origin of this API, e.g. https://api.mizuki.com.sg — used to build magic links. */
  PUBLIC_API_URL: z.string().url(),
  /** The WordPress site, used for redirects back into the shop and the booking page. */
  PUBLIC_SITE_URL: z.string().url(),
  /** Comma-separated origins allowed to call the API from a browser. */
  CORS_ORIGINS: z.string().default(''),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Mizuki Flora <hello@mizuki.com.sg>'),
  MAIL_REPLY_TO: z.string().optional(),
  /** Where "someone just booked" alerts land. */
  ADMIN_ALERT_EMAIL: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:hello@mizuki.com.sg'),

  /** Minutes a WooCommerce checkout holds a place before it goes back on sale. */
  HOLD_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(20),
  /** How far ahead the public calendar and the session generator run. */
  CALENDAR_MONTHS_AHEAD: z.coerce.number().int().min(1).max(12).default(3),
  /** Studio-local hour for the 2-day reminder and the daily digest. */
  REMINDER_SEND_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  DIGEST_SEND_HOUR: z.coerce.number().int().min(0).max(23).default(7),

  /*
   * Nightly backups. MongoDB's free tier has no automated backups, so the app takes its own —
   * onto the web host's disk, which is a different provider from the database and therefore a
   * real second copy rather than the same risk twice.
   */
  /*
   * Run the scheduled work in-process rather than relying on an external cron.
   *
   * Set SCHEDULER_ENABLED=false only if something else is definitely hitting /api/jobs/tick —
   * with neither, reminders stop, held places never release and no backups are taken, all
   * silently.
   */
  SCHEDULER_ENABLED: booleanFromEnv.default(true),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),

  /** Where the built studio console lives. Defaults to apps/admin/dist beside this app. */
  ADMIN_DIST_DIR: z.string().optional(),

  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(30),
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}`)
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const

export type Config = typeof config
