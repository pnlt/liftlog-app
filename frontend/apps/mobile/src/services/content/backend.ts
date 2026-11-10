import { CatalogPageSchema, type Exercise } from '@myos/contracts'
import type { ApiClient } from '../api/client'

/** Return a complete validated release so a failed page never partially replaces the cache. */
export async function fetchBackendCatalog(api: ApiClient, signal?: AbortSignal): Promise<Exercise[]> {
  const items: Exercise[] = []
  const seenCursors = new Set<string>()
  let revision: string | undefined
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: '200' })
    if (revision) params.set('revision', revision)
    if (cursor) params.set('cursor', cursor)
    const page = await api.request(`/exercises?${params.toString()}`, CatalogPageSchema, { signal })
    if (revision && revision !== page.revision) throw new Error('Catalog revision changed between pages')
    revision = page.revision
    if (page.nextCursor && seenCursors.has(page.nextCursor)) throw new Error('Catalog cursor did not advance')
    if (page.nextCursor) seenCursors.add(page.nextCursor)
    items.push(...page.items)
    if (items.length > 10_000) throw new Error("Catalog exceeds this app version's supported size")
    cursor = page.nextCursor
  } while (cursor !== null)
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('Duplicate catalog exercise')
  return items
}
