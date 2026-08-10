import mongoose from 'mongoose'
import { config } from './config.js'
import { logger } from './logger.js'

let connecting: Promise<typeof mongoose> | null = null

export async function connectDb(uri: string = config.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose
  if (connecting) return connecting

  mongoose.set('strictQuery', true)

  connecting = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 10,
      retryWrites: true,
    })
    .then((m) => {
      logger.info({ host: m.connection.host, db: m.connection.name }, 'MongoDB connected')
      return m
    })
    .catch((err) => {
      connecting = null
      throw err
    })

  return connecting
}

export async function disconnectDb(): Promise<void> {
  connecting = null
  await mongoose.disconnect()
}

/**
 * Seat reservation must be atomic across two collections (Session counter + Booking row),
 * which needs a transaction — and transactions need a replica set. Atlas always is one;
 * a bare local mongod is not. We detect support once so the seat service can fall back to
 * its single-document guard (still safe against overbooking) in local development.
 */
let transactionSupport: boolean | null = null

export async function supportsTransactions(): Promise<boolean> {
  if (transactionSupport !== null) return transactionSupport
  try {
    const admin = mongoose.connection.db?.admin()
    const info = await admin?.command({ hello: 1 })
    transactionSupport = Boolean(info?.setName || info?.msg === 'isdbgrid')
  } catch {
    transactionSupport = false
  }
  if (!transactionSupport) {
    logger.warn(
      'MongoDB is not a replica set — running without transactions. Seat counts stay safe via the atomic guard, but booking writes are not rolled back as a unit. Use Atlas in production.',
    )
  }
  return transactionSupport
}

export function resetTransactionSupportCache(): void {
  transactionSupport = null
}
