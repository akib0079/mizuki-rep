import { createApp } from './app.js'
import { connectDb, disconnectDb } from './db.js'
import { config } from './config.js'
import { logger } from './logger.js'
import mongoose from 'mongoose'
import './models/index.js'

async function main(): Promise<void> {
  await connectDb()

  // Build indexes on boot so the partial unique index that prevents double-booking is
  // guaranteed present, rather than depending on someone having run a migration.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))
  logger.info('Indexes synchronised')

  warnAboutSilentMisconfiguration()

  const app = createApp()
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Mizuki booking API listening')
  })

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down')
    server.close(async () => {
      await disconnectDb()
      process.exit(0)
    })
    // Do not hang forever on a stuck connection during a Hostinger redeploy.
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

/**
 * Shout about the settings whose absence is silent.
 *
 * These are not fatal — the system runs fine without them — which is exactly the problem: a
 * studio that forgets RESEND_API_KEY gets no confirmations and no reminders, and finds out from
 * a student who turned up on the wrong day. Better to say so at every boot.
 */
function warnAboutSilentMisconfiguration(): void {
  if (!config.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is not set — no confirmations or reminders will be sent to students.')
  }

  const hasAdminAlerts =
    Boolean(config.ADMIN_ALERT_EMAIL) ||
    Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) ||
    Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)

  if (!hasAdminAlerts) {
    logger.warn(
      'No admin alert channel is configured — you will NOT be notified when someone books. Set ADMIN_ALERT_EMAIL, or a Telegram bot token and chat id.',
    )
  }

  if (!config.WOO_WEBHOOK_SECRET) {
    logger.warn('WOO_WEBHOOK_SECRET is not set — shop payments cannot confirm held places.')
  }

  if (config.isProduction && config.corsOrigins.length === 0) {
    logger.warn('CORS_ORIGINS is empty in production — any website could call this API from a browser.')
  }
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start')
  process.exit(1)
})
