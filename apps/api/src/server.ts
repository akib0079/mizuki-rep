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

main().catch((err) => {
  logger.error({ err }, 'Failed to start')
  process.exit(1)
})
