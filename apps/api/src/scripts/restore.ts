import { gunzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import path from 'node:path'
import mongoose from 'mongoose'
import { EJSON } from 'bson'
import { connectDb, disconnectDb } from '../db.js'
import { config } from '../config.js'

/**
 * Restore the database from a nightly backup.
 *
 * Interactive and deliberately blunt about what it is going to do, because this replaces every
 * record in the database and there is no undo. Run it as:
 *
 *   npm run restore -- mizuki-2026-10-01T0300.json.gz
 *
 * The backup is Extended JSON, so ObjectIds and dates come back as real BSON types rather than
 * strings — a restore that inserted them as text would look successful and leave every date
 * unqueryable and every relationship broken.
 */
async function main(): Promise<void> {
  const name = process.argv[2]
  if (!name) {
    console.error('Usage: npm run restore -- <backup-file.json.gz>')
    console.error(`Backups live in ${path.resolve(config.BACKUP_DIR)}`)
    process.exit(1)
  }

  const file = path.isAbsolute(name) ? name : path.join(path.resolve(config.BACKUP_DIR), name)
  const dump = EJSON.parse(gunzipSync(await readFile(file)).toString('utf8'), { relaxed: false }) as {
    exportedAt: string
    database: string
    collections: Record<string, Record<string, unknown>[]>
  }

  const summary = Object.entries(dump.collections)
    .filter(([, docs]) => docs.length > 0)
    .map(([name, docs]) => `  ${name}: ${docs.length}`)
    .join('\n')

  await connectDb()
  const db = mongoose.connection.db!

  console.log(`\nBackup taken ${dump.exportedAt}, from database "${dump.database}".`)
  console.log(summary)
  console.log(`\nThis will DELETE everything currently in "${db.databaseName}" and replace it.\n`)

  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`Type the database name (${db.databaseName}) to continue: `)
  rl.close()

  if (answer.trim() !== db.databaseName) {
    console.log('Nothing changed.')
    await disconnectDb()
    return
  }

  for (const collection of await db.collections()) {
    await collection.deleteMany({})
  }

  let restored = 0
  for (const [name, docs] of Object.entries(dump.collections)) {
    if (docs.length === 0) continue
    await db.collection(name).insertMany(docs as never[])
    restored += docs.length
  }

  // Indexes are defined in code, not carried in the backup, so rebuild them afterwards.
  await import('../models/index.js')
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))

  console.log(`\nRestored ${restored} documents and rebuilt indexes.`)
  await disconnectDb()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
