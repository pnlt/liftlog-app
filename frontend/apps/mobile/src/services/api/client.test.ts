import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiClient, ApiError } from './client'

describe('authenticated API boundary', () => {
  it('calls browser fetch with the global receiver', async () => {
    const browserFetch: typeof fetch = async function (this: unknown) {
      if (this !== globalThis)
        throw new TypeError("'fetch' called on an object that does not implement interface Window.")
      return new Response('{"restored":true}')
    }
    const api = new ApiClient('https://api.test', async () => 'session', browserFetch)
    await expect(api.request('/test', z.object({ restored: z.boolean() }))).resolves.toEqual({
      restored: true,
    })
  })

  it('validates a response before exposing it to the app', async () => {
    const api = new ApiClient(
      'http://localhost:8000',
      async () => 'session',
      async () => new Response('{"value":"bad"}'),
    )
    await expect(api.request('/test', z.object({ value: z.number() }))).rejects.toThrow()
  })

  it('does not send a request when account ownership changes while obtaining the token', async () => {
    let active = true
    const requests: string[] = []
    const api = new ApiClient(
      'http://localhost:8000',
      async () => {
        active = false
        return 'new-account-token'
      },
      async (url) => {
        requests.push(String(url))
        return new Response('{}')
      },
      () => active,
    )
    await expect(api.request('/test', z.object({}))).rejects.toThrow()
    expect(requests).toEqual([])
  })

  it('uses the current Clerk token and preserves structured conflict details', async () => {
    let authorization = ''
    const api = new ApiClient(
      'http://localhost:8000/',
      async () => 'clerk-token',
      async (_url, init) => {
        authorization = new Headers(init?.headers).get('Authorization') ?? ''
        return new Response(
          JSON.stringify({
            error: { code: 'VERSION_CONFLICT', message: 'Changed remotely', details: { current: null } },
          }),
          { status: 409 },
        )
      },
    )
    try {
      await api.request('/test', z.object({}))
      expect.fail('Expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(409)
      expect((error as ApiError).details).toEqual({ current: null })
    }
    expect(authorization).toBe('Bearer clerk-token')
  })
})
