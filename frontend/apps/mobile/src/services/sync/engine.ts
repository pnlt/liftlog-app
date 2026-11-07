import { SyncAckSchema, SyncChangeSchema, SyncPageSchema } from '@myos/contracts'
import { z } from 'zod'
import type { SyncRepository } from '../../data/sync/repository'
import { ApiClient, ApiError } from '../api/client'

export interface SyncEngineState {
  state: 'idle' | 'syncing' | 'offline' | 'auth' | 'error'
  message: string | null
}
interface SyncEngineOptions {
  owner: string
  api: ApiClient
  repository: SyncRepository
  isActive: () => boolean
  onState: (state: SyncEngineState) => void
}
const accountSchema = z.object({ id: z.uuid() })
const conflictSchema = z.object({ current: SyncChangeSchema.nullable() })

/** A foreground pass is bounded by mutations; the provider owns retry timing and lifecycle. */
export function createSyncEngine({ owner, api, repository, isActive, onState }: SyncEngineOptions) {
  let stopped = false
  let running: Promise<void> | null = null
  let request: AbortController | null = null
  const active = () => !stopped && isActive()

  async function pull(signal: AbortSignal): Promise<boolean> {
    while (active()) {
      const cursor = repository.cursor(owner)
      const page = await api.request(`/sync/changes?cursor=${cursor}&limit=200`, SyncPageSchema, { signal })
      if (!active()) return false
      if (
        page.nextCursor < cursor ||
        page.changes.some((change) => change.revision <= cursor) ||
        (page.hasMore && page.nextCursor <= cursor)
      ) {
        throw new Error('The server change feed did not advance. Retry synchronization later.')
      }
      repository.applyPage(owner, page)
      if (!page.hasMore) return true
    }
    return false
  }

  async function synchronize(signal: AbortSignal): Promise<void> {
    if (!active()) return
    onState({ state: 'syncing', message: null })
    await repository.prepare(owner)
    if (!active()) return
    const account = await api.request('/users/me', accountSchema, { signal })
    if (!active()) return
    repository.setBackendUserId(owner, account.id)
    if (!(await pull(signal)) || !active()) return
    repository.setBootstrapped(owner)

    let sent = 0
    for (; sent < 100 && active(); sent++) {
      const mutation = repository.next(owner)
      if (!mutation || !active()) break
      try {
        const ack = await api.request('/sync/mutations', SyncAckSchema, {
          method: 'POST',
          body: JSON.stringify(mutation),
          signal,
        })
        if (!active()) return
        if (
          ack.mutationId !== mutation.mutationId ||
          ack.change.mutationId !== mutation.mutationId ||
          ack.change.entityType !== mutation.entityType ||
          ack.change.entityId !== mutation.entityId
        ) {
          throw new Error(
            'The server acknowledgment did not match the queued change. Your local changes are preserved.',
          )
        }
        repository.acknowledge(owner, ack)
      } catch (error) {
        if (!active()) return
        if (error instanceof ApiError && error.status === 409) {
          const conflict = conflictSchema.parse(error.details)
          repository.conflict(owner, mutation.mutationId, conflict.current)
        } else if (error instanceof ApiError && [400, 403, 404, 413, 422].includes(error.status)) {
          repository.reject(owner, mutation.mutationId, error.message)
        } else {
          // A timeout or malformed acknowledgment may have followed a committed write.
          // Keep the frozen body so a later pull or identical retry can reconcile it.
          throw error
        }
      }
    }
    if (sent > 0 && (!(await pull(signal)) || !active())) return
    if (active()) onState({ state: 'idle', message: null })
  }

  return {
    run(): Promise<void> {
      if (running) return running
      if (!active()) return Promise.resolve()
      request = new AbortController()
      const signal = request.signal
      running = Promise.resolve()
        .then(() => synchronize(signal))
        .catch((error: unknown) => {
          if (!active()) return
          if (error instanceof ApiError && error.status === 401) {
            onState({ state: 'auth', message: 'Sign in again to synchronize your data.' })
          } else if (
            error instanceof TypeError ||
            (error instanceof Error && error.name === 'AbortError') ||
            (error instanceof ApiError &&
              (error.status >= 500 || error.status === 408 || error.status === 429))
          ) {
            onState({
              state: 'offline',
              message: 'Your changes are saved on this device. Synchronization will retry.',
            })
          } else {
            onState({
              state: 'error',
              message:
                error instanceof z.ZodError
                  ? 'The server returned data this app could not validate. Your local changes are preserved.'
                  : error instanceof Error
                    ? error.message
                    : 'Synchronization failed. Your local changes are preserved.',
            })
          }
        })
        .finally(() => {
          running = null
          request = null
        })
      return running
    },
    stop(): void {
      stopped = true
      request?.abort()
    },
  }
}
