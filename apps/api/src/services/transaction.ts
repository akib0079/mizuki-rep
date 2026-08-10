import mongoose, { type ClientSession } from 'mongoose'
import { supportsTransactions } from '../db.js'

/**
 * Run work inside a transaction when the deployment can (Atlas always can), otherwise run it
 * directly. Callers must still be written so that a `null` session is correct — which in practice
 * means compensating by hand on failure. The seat counter itself is safe either way: it is guarded
 * by a single atomic document update, not by the transaction.
 */
export async function withTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) {
    return fn(null)
  }

  const session = await mongoose.startSession()
  try {
    let result: T
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result!
  } finally {
    await session.endSession()
  }
}

/** Mongo's duplicate-key error, which we turn into a friendly "you're already booked" message. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}
