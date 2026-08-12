import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { LoginTokenModel, StudentModel } from '../models/index.js'
import { seedEmailTemplates } from '../services/emailTemplates.js'

/**
 * Sign-in links have to survive being scanned.
 *
 * Mail providers fetch the links in a message before showing it, to check them for phishing.
 * With a strictly single-use token that fetch spends the link, and the student is told their
 * brand new sign-in link has already been used — with no way out, because the replacement gets
 * scanned in exactly the same way. This is what happened in production.
 */

const app = createApp()

async function issueLink(email: string): Promise<string> {
  await request(app).post('/api/auth/magic-link').send({ email }).expect(200)

  const record = await LoginTokenModel.findOne().sort({ createdAt: -1 }).lean()
  expect(record).toBeTruthy()

  // The raw token is only ever in the emailed URL, so read it back out of the queued message.
  const { OutboxModel } = await import('../models/index.js')
  const message = await OutboxModel.findOne({ type: 'magic_link' }).sort({ createdAt: -1 }).lean()
  const token = message!.bodyText.match(/token=([A-Za-z0-9_-]+)/)?.[1]

  expect(token).toBeTruthy()
  return token!
}

beforeEach(async () => {
  await seedEmailTemplates()
  await StudentModel.create({ name: 'Ayesha Akter', email: 'ayesha@example.com', phone: '+65 9123 4567' })
})

describe('sign-in links', () => {
  it('still works for the student after a scanner has already fetched it', async () => {
    const token = await issueLink('ayesha@example.com')

    // The provider's scanner gets there first.
    await request(app).get(`/api/auth/magic-link/verify?token=${token}`).expect(302)

    // Now the person taps the button in their email.
    const response = await request(app).get(`/api/auth/magic-link/verify?token=${token}`).expect(302)

    const cookies = response.headers['set-cookie'] as unknown as string[] | undefined
    expect(cookies?.some((c) => c.startsWith('mizuki_student='))).toBe(true)
  })

  it('signs the student in on the very first click', async () => {
    const token = await issueLink('ayesha@example.com')
    const response = await request(app).get(`/api/auth/magic-link/verify?token=${token}`).expect(302)

    const cookies = response.headers['set-cookie'] as unknown as string[] | undefined
    expect(cookies?.some((c) => c.startsWith('mizuki_student='))).toBe(true)
  })

  it('stops working once the link itself has expired', async () => {
    const token = await issueLink('ayesha@example.com')

    // The grace window must not outlive the link — expiry is still the hard limit.
    await LoginTokenModel.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } })

    await request(app).get(`/api/auth/magic-link/verify?token=${token}`).expect(401)
  })

  it('stops working once the grace window has passed', async () => {
    const token = await issueLink('ayesha@example.com')
    await request(app).get(`/api/auth/magic-link/verify?token=${token}`).expect(302)

    // Used well over the grace window ago, but not yet expired — a link left in an inbox and
    // clicked again much later must not still sign someone in.
    await LoginTokenModel.updateOne({}, { $set: { usedAt: new Date(Date.now() - 30 * 60_000) } })

    await request(app).get(`/api/auth/magic-link/verify?token=${token}`).expect(401)
  })

  it('never accepts a token that was not issued', async () => {
    await request(app).get('/api/auth/magic-link/verify?token=not-a-real-token').expect(401)
  })
})
