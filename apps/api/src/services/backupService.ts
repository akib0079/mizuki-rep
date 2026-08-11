import { createGzip } from 'node:zlib'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink, readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import mongoose from 'mongoose'
import { EJSON } from 'bson'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * Nightly backups, written by the app itself.
 *
 * MongoDB's free tier has no automated backups, and for a booking system that is the one gap
 * that actually matters: lose the database and the studio cannot reconstruct who paid for what.
 * The data is tiny — the studio's whole year is well under a megabyte — so a full export every
 * night is cheap, and writing it to the Hostinger disk puts the copy on a different provider
 * from the database, which is what makes it a backup rather than a second copy of the same risk.
 *
 * Deliberately not `mongodump`: that binary may not exist on a managed Node host. Reading
 * through the driver works anywhere the app itself runs.
 *
 * These files contain student names, emails and phone numbers. They belong on the studio's own
 * disk, never in the git repository and never emailed around.
 */

export interface BackupResult {
  file: string
  bytes: number
  collections: { name: string; documents: number }[]
  totalDocuments: number
  durationMs: number
}

function backupDir(): string {
  return path.resolve(config.BACKUP_DIR)
}

/** Write a full export of every collection as one gzipped JSON file. */
export async function runBackup(now: Date = new Date()): Promise<BackupResult> {
  const startedAt = Date.now()
  const dir = backupDir()
  await mkdir(dir, { recursive: true })

  const stamp = DateTime.fromJSDate(now).setZone(STUDIO_TZ).toFormat("yyyy-MM-dd'T'HHmm")
  const file = path.join(dir, `mizuki-${stamp}.json.gz`)

  const db = mongoose.connection.db
  if (!db) throw new Error('No database connection')

  const collections = await db.collections()
  const summary: { name: string; documents: number }[] = []

  // Streamed rather than assembled in memory, so a large outbox cannot exhaust the
  // modest RAM a shared host gives a Node process.
  async function* lines() {
    yield `{"exportedAt":${JSON.stringify(now.toISOString())},"database":${JSON.stringify(db!.databaseName)},"format":"ejson","collections":{`

    let firstCollection = true
    for (const collection of collections) {
      if (!firstCollection) yield ','
      firstCollection = false
      yield `${JSON.stringify(collection.collectionName)}:[`

      let count = 0
      for await (const doc of collection.find({})) {
        // Extended JSON, not plain JSON. `JSON.stringify` flattens an ObjectId to a bare
        // string and a Date to an ISO string, so a restore would insert documents whose _id
        // was text and whose dates could not be compared — the export would look complete
        // and be useless. EJSON round-trips both back to real BSON types.
        yield (count === 0 ? '' : ',') + EJSON.stringify(doc, { relaxed: false })
        count++
      }

      yield ']'
      summary.push({ name: collection.collectionName, documents: count })
    }

    yield '}}'
  }

  await pipeline(Readable.from(lines()), createGzip({ level: 9 }), createWriteStream(file))

  const { size } = await stat(file)
  const result: BackupResult = {
    file: path.basename(file),
    bytes: size,
    collections: summary,
    totalDocuments: summary.reduce((n, c) => n + c.documents, 0),
    durationMs: Date.now() - startedAt,
  }

  await pruneOldBackups()
  logger.info(result, 'Backup written')
  return result
}

/** Keep the most recent N and delete the rest, so the disk cannot fill unnoticed. */
async function pruneOldBackups(): Promise<number> {
  const dir = backupDir()
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json.gz')).sort()

  const excess = files.slice(0, Math.max(0, files.length - config.BACKUP_KEEP))
  for (const file of excess) {
    await unlink(path.join(dir, file)).catch(() => undefined)
  }
  return excess.length
}

export interface BackupFile {
  file: string
  bytes: number
  createdAt: string
}

export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupDir()
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json.gz'))
    const rows = await Promise.all(
      files.map(async (file) => {
        const info = await stat(path.join(dir, file))
        return { file, bytes: info.size, createdAt: info.mtime.toISOString() }
      }),
    )
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/** Read one backup for download. The name is checked rather than trusted — it arrives from a URL. */
export async function readBackup(name: string): Promise<Buffer> {
  if (!/^mizuki-[\dT-]+\.json\.gz$/.test(name)) {
    throw new Error('Not a backup file name')
  }
  return readFile(path.join(backupDir(), name))
}

/**
 * How stale the newest backup is, in hours. The dashboard uses this: a backup job that quietly
 * stopped running looks exactly like one that is working until the day it is needed.
 */
export async function hoursSinceLastBackup(now: Date = new Date()): Promise<number | null> {
  const [newest] = await listBackups()
  if (!newest) return null
  return (now.getTime() - new Date(newest.createdAt).getTime()) / 3_600_000
}

/**
 * Delete sent messages older than the retention window.
 *
 * The outbox keeps a full HTML copy of everything sent, which is by far the fastest-growing
 * collection. Ninety days is long enough to answer "did that reminder go out?" and short enough
 * that the database does not grow without bound.
 */
export async function pruneOutbox(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 3600_000)
  const { OutboxModel } = await import('../models/index.js')

  const result = await OutboxModel.deleteMany({ status: 'sent', sentAt: { $lt: cutoff } })
  if (result.deletedCount > 0) {
    logger.info({ deleted: result.deletedCount }, 'Pruned old sent messages')
  }
  return result.deletedCount
}
