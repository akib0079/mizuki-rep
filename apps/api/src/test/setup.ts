import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { connectDb, disconnectDb, resetTransactionSupportCache } from '../db.js'
import '../models/index.js'

/**
 * Tests run against a real mongod as a single-node replica set, not a mock.
 *
 * The replica set matters: transactions only exist on one, and the seat-reservation guard is
 * exactly the kind of concurrency behaviour a mocked driver would happily pretend works. The
 * point of these tests is to exercise the real `findOneAndUpdate` semantics.
 */
let replSet: MongoMemoryReplSet | undefined

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  })
  await connectDb(replSet.getUri('mizuki-test'))
  resetTransactionSupportCache()

  // Build the real indexes — including the partial unique index that stops a student
  // holding two live places in one class. Testing without them would prove nothing.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))
})

afterEach(async () => {
  const collections = mongoose.connection.collections
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})))
})

afterAll(async () => {
  await disconnectDb()
  await replSet?.stop()
})
