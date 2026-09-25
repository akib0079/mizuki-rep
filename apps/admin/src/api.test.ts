import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api.js'

afterEach(() => vi.unstubAllGlobals())

it('lets an unauthenticated session probe finish instead of refetching itself', async () => {
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', { dispatchEvent })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { code: 'unauthenticated', message: 'Please sign in.' },
  }), { status: 401 })))

  await expect(api.get('/api/auth/admin/me')).rejects.toMatchObject({ status: 401 })
  expect(dispatchEvent).not.toHaveBeenCalled()
})
