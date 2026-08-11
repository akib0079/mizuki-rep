import { gunzipSync } from 'node:zlib'
import { EJSON } from 'bson'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hoursSinceLastBackup, listBackups, pruneOutbox, readBackup, runBackup } from './backupService.js'
import { config } from '../config.js'
import { BookingModel, OutboxModel, SessionModel, StudentModel } from '../models/index.js'
import { createBooking } from './bookingService.js'
import { makeCourseType, makeSession, makeStudent } from '../test/factories.js'

/**
 * A backup nobody has restored is a guess, not a backup.
 *
 * These write a real file, read it back, and check the studio's actual records survive the round
 * trip — which is the only property that matters when the database is gone.
 */
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mizuki-backup-'))
  // The config object is frozen at import; point it at a scratch directory for these tests.
  Object.defineProperty(config, 'BACKUP_DIR', { value: dir, configurable: true })
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function studioWithData() {
  const course = await makeCourseType({ name: 'Ikebana', bookingMode: 'paid' })
  const session = await makeSession({ courseTypeId: course._id, capacity: 6, date: '2026-10-17' })
  const student = await makeStudent({ name: 'Aiko Tan', email: 'aiko@example.com', phone: '+65 9123 4567' })
  const { booking } = await createBooking({
    sessionId: session._id,
    studentId: student._id,
    usePackage: false,
    notify: false,
  })
  return { course, session, student, booking }
}

/** Decompress a backup and parse it, the way a restore would. */
async function readBackupJson(file: string) {
  const raw = await readFile(path.join(dir, file))
  // Parsed as Extended JSON so ObjectIds and Dates come back as real BSON types.
  return EJSON.parse(gunzipSync(raw).toString('utf8'), { relaxed: false }) as {
    collections: Record<string, Record<string, unknown>[]>
  }
}

describe('nightly backup', () => {
  beforeEach(async () => {
    for (const file of await listBackups()) {
      await rm(path.join(dir, file.file), { force: true })
    }
  })

  it('writes a compressed export of every collection', async () => {
    await studioWithData()

    const result = await runBackup(new Date('2026-10-01T03:00:00Z'))

    expect(result.file).toMatch(/^mizuki-2026-10-01T\d{4}\.json\.gz$/)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.totalDocuments).toBeGreaterThan(0)
  })

  it('round-trips the studio’s records intact', async () => {
    const { student, booking, session } = await studioWithData()

    const result = await runBackup()
    const dump = await readBackupJson(result.file)

    // The things that could not be reconstructed from anywhere else.
    const students = dump.collections.students
    const bookings = dump.collections.bookings
    const sessions = dump.collections.sessions

    expect(students.find((s: { email: string }) => s.email === 'aiko@example.com')).toMatchObject({
      name: 'Aiko Tan',
      phone: '+65 9123 4567',
    })
    expect(bookings.some((b: { _id: string }) => String(b._id) === String(booking._id))).toBe(true)
    expect(sessions.some((s: { _id: string }) => String(s._id) === String(session._id))).toBe(true)
    expect(String(students[0]._id)).toBe(String(student._id))
  })

  it('is genuinely restorable — wiping the database and reloading brings it back', async () => {
    const { student, booking } = await studioWithData()
    const before = {
      students: await StudentModel.countDocuments(),
      bookings: await BookingModel.countDocuments(),
      sessions: await SessionModel.countDocuments(),
    }

    const result = await runBackup()
    const dump = await readBackupJson(result.file)

    // The disaster.
    const db = mongoose.connection.db!
    for (const collection of await db.collections()) await collection.deleteMany({})
    expect(await StudentModel.countDocuments()).toBe(0)

    // The restore: insert each collection back exactly as exported.
    for (const [name, docs] of Object.entries(dump.collections as Record<string, unknown[]>)) {
      if (docs.length === 0) continue
      await db.collection(name).insertMany(docs as never[])
    }

    expect(await StudentModel.countDocuments()).toBe(before.students)
    expect(await BookingModel.countDocuments()).toBe(before.bookings)
    expect(await SessionModel.countDocuments()).toBe(before.sessions)

    // And the restored records are the same records, not merely the same count.
    const restored = await StudentModel.findById(student._id)
    expect(restored!.email).toBe('aiko@example.com')
    expect(await BookingModel.findById(booking._id)).toBeTruthy()
  })

  it('keeps only the most recent files', async () => {
    Object.defineProperty(config, 'BACKUP_KEEP', { value: 3, configurable: true })
    await studioWithData()

    for (let i = 1; i <= 5; i++) {
      await runBackup(new Date(`2026-10-0${i}T03:00:00Z`))
    }

    const files = await listBackups()
    expect(files).toHaveLength(3)
    // The three kept are the newest three.
    expect(files[0]!.file).toContain('2026-10-05')
    expect(files.some((f) => f.file.includes('2026-10-01'))).toBe(false)

    Object.defineProperty(config, 'BACKUP_KEEP', { value: 30, configurable: true })
  })

  it('reports how stale the newest backup is', async () => {
    expect(await hoursSinceLastBackup()).toBeNull()

    await studioWithData()
    await runBackup()

    const age = await hoursSinceLastBackup()
    expect(age).not.toBeNull()
    expect(age!).toBeLessThan(1)
  })

  it('refuses a filename that tries to climb out of the backup folder', async () => {
    // The name arrives from a URL, so it is checked rather than trusted.
    await expect(readBackup('../../../etc/passwd')).rejects.toThrow(/backup file name/)
    await expect(readBackup('mizuki-2026-10-01T0300.json.gz/../../secret')).rejects.toThrow()
  })
})

describe('outbox pruning', () => {
  it('clears sent messages past the retention window but keeps recent and unsent ones', async () => {
    const old = new Date(Date.now() - 100 * 24 * 3600_000)

    await OutboxModel.create([
      { type: 'x', dedupeKey: 'old-sent', channel: 'email', status: 'sent', sentAt: old },
      { type: 'x', dedupeKey: 'recent-sent', channel: 'email', status: 'sent', sentAt: new Date() },
      { type: 'x', dedupeKey: 'old-pending', channel: 'email', status: 'pending' },
      { type: 'x', dedupeKey: 'old-failed', channel: 'email', status: 'failed', sentAt: old },
    ])

    const deleted = await pruneOutbox()

    expect(deleted).toBe(1)
    // A failed message is evidence of a problem and is deliberately kept.
    expect(await OutboxModel.countDocuments()).toBe(3)
    expect(await OutboxModel.exists({ dedupeKey: 'old-sent' })).toBeNull()
    expect(await OutboxModel.exists({ dedupeKey: 'old-failed' })).toBeTruthy()
  })
})
