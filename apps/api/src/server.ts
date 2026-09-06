import { createApp } from './app.js'
import { connectDb, disconnectDb } from './db.js'
import { config } from './config.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { backfillPhoneDigits, backfillReferences } from './services/studentReference.js'
import { notificationRecipients } from './services/adminNotificationService.js'
import { refreshDefaultTemplates } from './services/emailTemplates.js'
import { logger } from './logger.js'
import mongoose from 'mongoose'
import './models/index.js'

async function main(): Promise<void> {
  await connectDb()

  // Build indexes on boot so the partial unique index that prevents double-booking is
  // guaranteed present, rather than depending on someone having run a migration.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))
  logger.info('Indexes synchronised')

  // Students who registered before references existed. No-op once it has run.
  await backfillPhoneDigits().catch((err) =>
    logger.error({ err }, 'Could not normalise student phone numbers'),
  )
  await backfillReferences().catch((err) =>
    logger.error({ err }, 'Student reference backfill failed — the API is still fine to serve'),
  )

  /*
   * The shipped wording changes with a deploy; anything the studio has written themselves does
   * not. No-op once it has run.
   */
  await refreshDefaultTemplates().catch((err) =>
    logger.error({ err }, 'Could not refresh the built-in email wording — the API is still fine to serve'),
  )

  await warnAboutSilentMisconfiguration()

  const app = createApp()
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Mizuki booking API listening')
  })

  startScheduler()

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down')
    stopScheduler()
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
async function warnAboutSilentMisconfiguration(): Promise<void> {
  if (!config.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is not set — no confirmations or reminders will be sent to students.')
  }

  /*
   * Ask who alerts would actually reach, rather than whether one environment variable is set.
   *
   * The old check tested `ADMIN_ALERT_EMAIL` and stayed quiet whenever it was present — which
   * says nothing about whether anybody hears anything, and said nothing at all about the studio
   * whose daily digest had never once been sent.
   */
  const recipients = await notificationRecipients().catch(() => [])

  if (recipients.length === 0) {
    logger.warn(
      'Nobody will receive booking alerts — there are no active admins and no extra addresses. Add someone on the Team page.',
    )
  } else {
    logger.info({ recipients: recipients.length }, 'Studio alerts will go to the team')
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
