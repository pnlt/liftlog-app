import { expect, it } from 'vitest'
import { ApiClient } from '../api/client'
import { fetchBackendCatalog } from './backend'

it('pins every page to one release and refuses mixed catalog revisions', async () => {
  const urls: string[] = []
  const api = new ApiClient(
    'http://localhost:8000',
    async () => 'token',
    async (url) => {
      urls.push(String(url))
      return new Response(
        JSON.stringify({
          revision: urls.length === 1 ? 'one' : 'two',
          items: [],
          nextCursor: urls.length === 1 ? '200' : null,
        }),
      )
    },
  )
  await expect(fetchBackendCatalog(api)).rejects.toThrow('revision')
  expect(urls[1]).toContain('revision=one')
})
