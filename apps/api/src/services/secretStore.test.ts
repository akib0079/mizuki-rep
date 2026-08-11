import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import argon2 from 'argon2'
import { Types } from 'mongoose'
import { createApp } from '../app.js'
import { COOKIE_NAMES, signAdminToken } from '../auth/tokens.js'
import { AdminUserModel, SettingModel } from '../models/index.js'
import {
  SECRET_KEYS,
  clearSecret,
  clearSecretCache,
  decryptSecret,
  describeSecret,
  encryptSecret,
  getSecret,
  setSecret,
} from './secretStore.js'

/**
 * Keys the studio can change from the console.
 *
 * The failure mode worth testing for is not "does it save" — it is "can the value get back out".
 * A settings screen that echoes a secret is a settings screen that leaks one.
 */
const app = createApp()
const KEY = 're_TESTKEY_abcdefghijklmnop'

/**
 * The session cookie is minted directly rather than by logging in each time.
 *
 * These tests are about the settings endpoints, not authentication, and signing in once per
 * case trips the login rate limiter — which is the limiter working correctly, not a bug to
 * design around.
 */
const ADMIN_ID = new Types.ObjectId('000000000000000000000a11')
let agent: ReturnType<typeof request.agent>

beforeEach(async () => {
  clearSecretCache()

  await AdminUserModel.create({
    _id: ADMIN_ID,
    name: 'Studio',
    email: 'studio@example.com',
    passwordHash: await argon2.hash('a-long-enough-password', { type: argon2.argon2id }),
    role: 'owner',
    active: true,
    tokenVersion: 0,
  })

  const token = signAdminToken({ sub: String(ADMIN_ID), email: 'studio@example.com', role: 'owner', v: 0 })
  agent = request.agent(app)
  agent.jar.setCookie(`${COOKIE_NAMES.admin}=${token}; Path=/`)
})

describe('secrets at rest', () => {
  it('round-trips through encryption', () => {
    const sealed = encryptSecret(KEY)
    expect(sealed).not.toContain(KEY)
    expect(decryptSecret(sealed)).toBe(KEY)
  })

  it('produces different ciphertext each time, so equal keys are not recognisable', () => {
    expect(encryptSecret(KEY)).not.toBe(encryptSecret(KEY))
  })

  it('refuses tampered ciphertext rather than returning something wrong', () => {
    const sealed = encryptSecret(KEY)
    const [iv, tag, data] = sealed.split('.')
    // Flip the payload but keep the tag: GCM must reject this.
    expect(decryptSecret(`${iv}.${tag}.${Buffer.from('tampered').toString('base64')}`)).toBeNull()
    expect(decryptSecret('nonsense')).toBeNull()
    expect(data).toBeTruthy()
  })

  it('never stores the key in readable form', async () => {
    await setSecret(SECRET_KEYS.resendApiKey, KEY, 'test')

    const row = await SettingModel.findOne({ key: SECRET_KEYS.resendApiKey }).lean()
    expect(String(row!.value)).not.toContain(KEY)
    expect(String(row!.value)).not.toContain('re_TESTKEY')
  })
})

describe('resolving a key', () => {
  it('prefers what the studio saved over what the server was deployed with', async () => {
    expect(await getSecret(SECRET_KEYS.resendApiKey, 'from-env')).toBe('from-env')

    await setSecret(SECRET_KEYS.resendApiKey, KEY, 'test')
    expect(await getSecret(SECRET_KEYS.resendApiKey, 'from-env')).toBe(KEY)
  })

  it('falls back to the environment once the stored one is cleared', async () => {
    await setSecret(SECRET_KEYS.resendApiKey, KEY, 'test')
    await clearSecret(SECRET_KEYS.resendApiKey, 'test')

    expect(await getSecret(SECRET_KEYS.resendApiKey, 'from-env')).toBe('from-env')
  })

  it('takes effect immediately, not after the cache expires', async () => {
    await setSecret(SECRET_KEYS.resendApiKey, 'first-key', 'test')
    expect(await getSecret(SECRET_KEYS.resendApiKey)).toBe('first-key')

    // Someone has just pasted a corrected key and is watching to see it work.
    await setSecret(SECRET_KEYS.resendApiKey, 'second-key', 'test')
    expect(await getSecret(SECRET_KEYS.resendApiKey)).toBe('second-key')
  })
})

describe('what the console can see', () => {
  it('masks a key rather than returning it', async () => {
    await setSecret(SECRET_KEYS.resendApiKey, KEY, 'test')

    const status = await describeSecret(SECRET_KEYS.resendApiKey)
    expect(status.configured).toBe(true)
    expect(status.source).toBe('studio')
    expect(status.hint).toBe('re_TES…mnop')
    expect(status.hint).not.toBe(KEY)
  })

  it('reports nothing configured when there is no key anywhere', async () => {
    expect(await describeSecret(SECRET_KEYS.resendApiKey)).toMatchObject({ configured: false, source: 'none' })
  })
})

describe('the settings endpoint', () => {
  it('requires an admin session', async () => {
    await request(app).get('/api/admin/settings/integrations').expect(401)
    await request(app).put('/api/admin/settings/integrations/resend').send({ value: KEY }).expect(401)
  })

  it('saves a key and never sends it back', async () => {
    await agent.put('/api/admin/settings/integrations/resend').send({ value: KEY }).expect(200)

    const res = await agent.get('/api/admin/settings/integrations').expect(200)

    // The whole point: the key is not recoverable through the screen that sets it.
    expect(JSON.stringify(res.body)).not.toContain(KEY)
    expect(res.body.email).toMatchObject({ configured: true, source: 'studio' })
    expect(res.body.email.hint).toBe('re_TES…mnop')
  })

  it('records that a key changed, without recording the key', async () => {
    await agent.put('/api/admin/settings/integrations/resend').send({ value: KEY }).expect(200)

    const audit = await agent.get('/api/admin/settings/audit?limit=20').expect(200)
    const entry = audit.body.entries.find((e: { action: string }) => e.action === 'integration.update')

    expect(entry).toBeTruthy()
    expect(JSON.stringify(audit.body)).not.toContain(KEY)
  })

  it('reverts to the server value when cleared', async () => {
    await agent.put('/api/admin/settings/integrations/resend').send({ value: KEY }).expect(200)
    await agent.delete('/api/admin/settings/integrations/resend').expect(200)

    const res = await agent.get('/api/admin/settings/integrations').expect(200)
    expect(res.body.email.source).not.toBe('studio')
  })

  it('rejects an empty value and an unknown setting', async () => {
    await agent.put('/api/admin/settings/integrations/resend').send({ value: '   ' }).expect(400)
    await agent.put('/api/admin/settings/integrations/not-a-thing').send({ value: 'x' }).expect(404)
  })
})
