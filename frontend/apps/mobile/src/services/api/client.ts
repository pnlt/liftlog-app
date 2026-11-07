import { z } from 'zod'

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string | null>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly isActive: () => boolean = () => true,
  ) {}

  async request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T> {
    const ensureActive = () => {
      if (!this.isActive() || options.signal?.aborted) throw new Error('Account request cancelled')
    }
    ensureActive()
    const token = await this.getToken()
    ensureActive()
    if (!token) throw new ApiError(401, 'SESSION_REQUIRED', 'Sign in to synchronize your data')
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 15_000)
    try {
      const headers = new Headers(options.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (options.body) headers.set('Content-Type', 'application/json')
      const response = await this.fetcher.call(
        globalThis,
        `${this.baseUrl.replace(/\/$/, '')}/api/v1${path}`,
        {
          ...options,
          headers,
          signal: controller.signal,
        },
      )
      ensureActive()
      const body: unknown = await response.json()
      ensureActive()
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body)
        throw new ApiError(
          response.status,
          parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
          parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
          parsed.success ? parsed.data.error.details : undefined,
        )
      }
      return schema.parse(body)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    }
  }
}
