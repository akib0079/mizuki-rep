import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import argon2 from 'argon2'
import { connectDb, disconnectDb } from '../db.js'
import { AdminUserModel } from '../models/index.js'

/**
 * Creates the studio's sign-in for the console.
 *
 * Interactive rather than flag-driven, so the password never lands in a shell history file or
 * a deployment log. Run once after the first deploy:  npm run create-admin
 */
async function main(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  try {
    await connectDb()

    const name = (await rl.question('Name: ')).trim()
    const email = (await rl.question('Email: ')).trim().toLowerCase()
    const password = (await rl.question('Password (at least 12 characters): ')).trim()
    const confirm = (await rl.question('Confirm password: ')).trim()

    if (!name || !email) throw new Error('Name and email are both required.')
    if (password.length < 12) throw new Error('Please choose a password of at least 12 characters.')
    if (password !== confirm) throw new Error('Those passwords do not match.')

    const existing = await AdminUserModel.findOne({ email })
    if (existing) {
      const replace = (await rl.question(`${email} already exists. Reset the password? (y/N) `)).trim().toLowerCase()
      if (replace !== 'y') {
        console.log('Nothing changed.')
        return
      }

      existing.passwordHash = await argon2.hash(password, { type: argon2.argon2id })
      // Ends every session that was signed in with the old password.
      existing.tokenVersion += 1
      existing.failedLoginCount = 0
      existing.lockedUntil = null
      await existing.save()

      console.log(`Password reset for ${email}. Any open sessions have been signed out.`)
      return
    }

    await AdminUserModel.create({
      name,
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: 'owner',
      active: true,
    })

    console.log(`Created ${email}. Sign in at /admin, then turn on two-factor under Settings.`)
  } finally {
    rl.close()
    await disconnectDb()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
