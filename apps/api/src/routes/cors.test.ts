import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import argon2 from 'argon2'
import { createApp } from '../app.js'
import { AdminUserModel } from '../models/index.js'
import { config } from '../config.js'

/**
 * Which origins may call the API.
 *
 * This went wrong in production in the least helpful way: the studio console is served from the
 * API's own domain, so a browser signing in sent Origin: https://api.mizuki.com.sg — an origin
 * nobody thought to list, because it is the server itself. cors() threw, the error handler
 * turned that into a 500, and the login screen said "something went wrong on our side" while
 * the same request from a terminal worked perfectly.
 */
const app = createApp()
const CREDENTIALS = { email: 'studio@example.com', password: 'a-long-enough-password' }

beforeEach(async () => {
  await AdminUserModel.create({
    name: 'Studio',
    email: CREDENTIALS.email,
    passwordHash: await argon2.hash(CREDENTIALS.password, { type: argon2.argon2id }),
    role: 'owner',
    active: true,
  })
})

const login = (origin?: string) => {
  const req = request(app).post('/api/auth/admin/login')
  if (origin) req.set('Origin', origin)
  return req.send(CREDENTIALS)
}

describe('signing in from a browser', () => {
  it('works from the API’s own domain, where the console is served', async () => {
    // The regression. This origin is never in CORS_ORIGINS because it is the server itself.
    const res = await login(new URL(config.PUBLIC_API_URL).origin)

    expect(res.status).toBe(200)
    expect(res.body.admin.email).toBe(CREDENTIALS.email)
  })

  it('works from the studio’s website, where the widget is embedded', async () => {
    await login(config.corsOrigins[0] ?? config.PUBLIC_SITE_URL).expect(200)
  })

  it('works with no Origin at all, as curl and server-to-server calls send', async () => {
    await login().expect(200)
  })
})

describe('an origin nobody allowed', () => {
  it('is refused without the browser being told it is a server fault', async () => {
    const res = await login('https://not-the-studio.example')

    // The request must not succeed as a credentialed cross-origin call...
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    // ...but it must not be reported as a 500 either, which is what hid the original bug.
    expect(res.status).not.toBe(500)
  })

  it('never returns a 500 for any origin, however odd', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:9999']) {
      const res = await login(origin)
      expect(res.status, `origin ${origin}`).not.toBe(500)
    }
  })
})

describe('the browser preflight', () => {
  it('is answered for the console’s own origin', async () => {
    const res = await request(app)
      .options('/api/auth/admin/login')
      .set('Origin', new URL(config.PUBLIC_API_URL).origin)
      .set('Access-Control-Request-Method', 'POST')

    expect(res.status).toBeLessThan(400)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })
})
