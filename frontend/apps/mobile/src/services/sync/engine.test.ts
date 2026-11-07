/// <reference types="node" />
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SyncMutation, SyncChange, SyncPage } from '@myos/contracts'
import { ApiClient } from '../api/client'
import { createSyncRepository, type SyncSqlite } from '../../data/sync/repository'
import { createSyncEngine, type SyncEngineState } from './engine'
const owner = 'user_alice',
  now = '2026-11-06T00:00:00.000Z',
  backendId = randomUUID()
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  const journal = JSON.parse(
    readFileSync(new URL('../../data/db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
  ) as { entries: { tag: string }[] }
  for (const { tag } of journal.entries)
    db.exec(readFileSync(new URL(`../../data/db/migrations/${tag}.sql`, import.meta.url), 'utf8'))
  const sqlite: SyncSqlite = {
    run: (sql, params = []) => {
      db.prepare(sql).run(...params)
    },
    get: <T>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...params) as T[],
    transaction: (work) => {
      db.exec('BEGIN')
      try {
        const r = work()
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
  return { db, repository: createSyncRepository(sqlite, { uuid: randomUUID, now: () => now }) }
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const page = (changes: SyncChange[] = [], nextCursor = 0, hasMore = false): SyncPage => ({
  changes,
  nextCursor,
  hasMore,
})
function change(m: SyncMutation, version: number, revision = version): SyncChange {
  return {
    mutationId: m.mutationId,
    entityType: m.entityType,
    entityId: m.entityId,
    version,
    revision,
    operation: m.operation === 'delete' ? 'delete' : 'upsert',
    payload: m.payload,
  } as SyncChange
}
function draft(repo: ReturnType<typeof createSyncRepository>) {
  const id = randomUUID()
  repo.saveWorkout(owner, {
    id,
    userId: owner,
    startedAt: now,
    endedAt: null,
    note: 'first',
    exercises: [],
    updatedAt: now,
    deletedAt: null,
  })
  return id
}

describe('foreground sync engine with real SQLite', () => {
  it('retains unknown commit outcomes and consumes a later own echo without duplicate send', async () => {
    const { db, repository } = database()
    const id = draft(repository),
      states: SyncEngineState[] = []
    let committed: SyncChange | undefined,
      sendCount = 0
    const api = new ApiClient(
      'https://api.test',
      async () => 'session',
      async (url, init) => {
        const path = String(url)
        if (path.endsWith('/users/me')) return response({ id: backendId })
        if (path.includes('/sync/changes')) {
          const cursor = Number(new URL(path).searchParams.get('cursor'))
          return response(committed && cursor < 1 ? page([committed], 1) : page([], committed ? 1 : 0))
        }
        sendCount++
        const mutation = JSON.parse(String(init?.body)) as SyncMutation
        committed = change(mutation, 1)
        throw new TypeError('connection closed after commit')
      },
    )
    const engine = createSyncEngine({
      owner,
      api,
      repository,
      isActive: () => true,
      onState: (s) => states.push(s),
    })
    await engine.run()
    expect(states.at(-1)?.state).toBe('offline')
    expect(repository.status(owner).pending).toBe(1)
    await engine.run()
    expect(states.at(-1)?.state).toBe('idle')
    expect(sendCount).toBe(1)
    expect(repository.status(owner).pending).toBe(0)
    expect(repository.readWorkout(owner, id)?.note).toBe('first')
    expect(repository.backendUserId(owner)).toBe(backendId)
    expect(repository.hasBootstrapped(owner)).toBe(true)
    db.close()
  })
  it('preserves an edit during send and serializes overlapping runs', async () => {
    const { db, repository } = database()
    const id = draft(repository),
      sent: SyncMutation[] = [],
      feed: SyncChange[] = []
    let release!: () => void, entered!: () => void
    const arrived = new Promise<void>((resolve) => {
        entered = resolve
      }),
      held = new Promise<void>((resolve) => {
        release = resolve
      })
    const api = new ApiClient(
      'https://api.test',
      async () => 'session',
      async (url, init) => {
        const path = String(url)
        if (path.endsWith('/users/me')) return response({ id: backendId })
        if (path.includes('/sync/changes')) {
          const cursor = Number(new URL(path).searchParams.get('cursor'))
          return response(
            page(
              feed.filter((item) => item.revision > cursor),
              feed.length,
            ),
          )
        }
        const mutation = JSON.parse(String(init?.body)) as SyncMutation
        sent.push(mutation)
        if (sent.length === 1) {
          entered()
          await held
        }
        const committed = change(mutation, sent.length)
        feed.push(committed)
        return response({ mutationId: mutation.mutationId, change: committed })
      },
    )
    const engine = createSyncEngine({ owner, api, repository, isActive: () => true, onState: () => {} })
    const first = engine.run()
    await arrived
    const second = engine.run()
    expect(second).toBe(first)
    repository.editWorkout(owner, id, (w) => ({ ...w, note: 'edited during send' }))
    release()
    await first
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ baseVersion: 1, payload: { note: 'edited during send' } })
    expect(repository.readWorkout(owner, id)?.note).toBe('edited during send')
    db.close()
  })
  it('does not apply a response after an account switch', async () => {
    const { db, repository } = database()
    draft(repository)
    let active = true
    const states: SyncEngineState[] = []
    const api = new ApiClient(
      'https://api.test',
      async () => 'session',
      async (url, init) => {
        if (String(url).endsWith('/users/me')) return response({ id: backendId })
        if (String(url).includes('/sync/changes')) return response(page())
        const mutation = JSON.parse(String(init?.body)) as SyncMutation
        active = false
        return response({ mutationId: mutation.mutationId, change: change(mutation, 1) })
      },
    )
    await createSyncEngine({
      owner,
      api,
      repository,
      isActive: () => active,
      onState: (s) => states.push(s),
    }).run()
    expect(repository.status(owner).pending).toBe(1)
    expect(states.at(-1)?.state).toBe('syncing')
    db.close()
  })
  it('pauses on 401 and keeps pending bodies untouched', async () => {
    const { db, repository } = database()
    draft(repository)
    const states: SyncEngineState[] = []
    const api = new ApiClient(
      'https://api.test',
      async () => null,
      async () => response({}),
    )
    await createSyncEngine({
      owner,
      api,
      repository,
      isActive: () => true,
      onState: (s) => states.push(s),
    }).run()
    expect(states.at(-1)?.state).toBe('auth')
    expect(repository.status(owner).pending).toBe(1)
    expect(repository.hasBootstrapped(owner)).toBe(false)
    db.close()
  })
  it('rejects cursor no-progress without marking incomplete bootstrap', async () => {
    const { db, repository } = database()
    const states: SyncEngineState[] = []
    repository.applyPage(owner, page([], 4))
    const mutation = {
      schemaVersion: 1,
      mutationId: randomUUID(),
      entityType: 'settings',
      entityId: 'self',
      baseVersion: 0,
      operation: 'upsert',
      payload: { unit: 'kg', restSeconds: 90, demoStyle: 'art', timeZone: 'UTC' },
    } as SyncMutation
    const api = new ApiClient(
      'https://api.test',
      async () => 'session',
      async (url) =>
        String(url).endsWith('/users/me')
          ? response({ id: backendId })
          : response(page([change(mutation, 1, 4)], 4, true)),
    )
    await createSyncEngine({
      owner,
      api,
      repository,
      isActive: () => true,
      onState: (s) => states.push(s),
    }).run()
    expect(states.at(-1)?.state).toBe('error')
    expect(repository.cursor(owner)).toBe(4)
    expect(repository.hasBootstrapped(owner)).toBe(false)
    db.close()
  })
  it('keeps frozen body after malformed acknowledgment', async () => {
    const { db, repository } = database()
    draft(repository)
    const states: SyncEngineState[] = []
    let body = ''
    const api = new ApiClient(
      'https://api.test',
      async () => 'session',
      async (url, init) => {
        if (String(url).endsWith('/users/me')) return response({ id: backendId })
        if (String(url).includes('/sync/changes')) return response(page())
        body = String(init?.body)
        return response({ mutationId: 'malformed', change: null })
      },
    )
    await createSyncEngine({
      owner,
      api,
      repository,
      isActive: () => true,
      onState: (s) => states.push(s),
    }).run()
    expect(states.at(-1)?.state).toBe('error')
    expect(repository.next(owner)).toEqual(JSON.parse(body))
    db.close()
  })
  it('stores validated conflict snapshots and keeps rejected drafts', async () => {
    const { db, repository } = database()
    const id = draft(repository)
    let conflict = true
    const api = new ApiClient(
      'https://api.test',
      async () => 'session',
      async (url, init) => {
        if (String(url).endsWith('/users/me')) return response({ id: backendId })
        if (String(url).includes('/sync/changes')) return response(page())
        const mutation = JSON.parse(String(init?.body)) as SyncMutation
        return conflict
          ? response(
              {
                error: {
                  code: 'VERSION_CONFLICT',
                  message: 'Changed',
                  details: { current: { ...change(mutation, 3), mutationId: randomUUID() } },
                },
              },
              409,
            )
          : response({ error: { code: 'INVALID', message: 'Correct the workout' } }, 422)
      },
    )
    const engine = createSyncEngine({ owner, api, repository, isActive: () => true, onState: () => {} })
    await engine.run()
    expect(repository.status(owner).conflicts).toBe(1)
    repository.resolve(owner, 'workout', id, 'local')
    conflict = false
    await engine.run()
    expect(repository.status(owner).invalid).toBe(1)
    expect(repository.readWorkout(owner, id)?.note).toBe('first')
    db.close()
  })
})

it('rejects a valid acknowledgment for another mutation after a single send', async () => {
  const { db, repository } = database()
  draft(repository)
  const states: SyncEngineState[] = []
  let sends = 0
  const api = new ApiClient(
    'https://api.test',
    async () => 'session',
    async (url, init) => {
      if (String(url).endsWith('/users/me')) return response({ id: backendId })
      if (String(url).includes('/sync/changes')) return response(page())
      sends++
      const mutation = { ...JSON.parse(String(init?.body)), mutationId: randomUUID() } as SyncMutation
      return response({ mutationId: mutation.mutationId, change: change(mutation, 1) })
    },
  )
  await createSyncEngine({
    owner,
    api,
    repository,
    isActive: () => true,
    onState: (s) => states.push(s),
  }).run()
  expect(sends).toBe(1)
  expect(states.at(-1)?.state).toBe('error')
  expect(repository.status(owner).pending).toBe(1)
  db.close()
})

it('drains every pull page before marking account bootstrapped', async () => {
  const { db, repository } = database()
  const cursors: number[] = [],
    bootstrapped: boolean[] = []
  const mutation = {
    schemaVersion: 1,
    mutationId: randomUUID(),
    entityType: 'settings',
    entityId: 'self',
    baseVersion: 0,
    operation: 'upsert',
    payload: { unit: 'kg', restSeconds: 90, demoStyle: 'art', timeZone: 'UTC' },
  } as SyncMutation
  const first = change(mutation, 1),
    second = change(
      { ...mutation, mutationId: randomUUID(), payload: { ...mutation.payload, unit: 'lb' } } as SyncMutation,
      2,
    )
  const api = new ApiClient(
    'https://api.test',
    async () => 'session',
    async (url) => {
      if (String(url).endsWith('/users/me')) return response({ id: backendId })
      const cursor = Number(new URL(String(url)).searchParams.get('cursor'))
      cursors.push(cursor)
      bootstrapped.push(repository.hasBootstrapped(owner))
      return response(cursor === 0 ? page([first], 1, true) : page([second], 2))
    },
  )
  await createSyncEngine({ owner, api, repository, isActive: () => true, onState: () => {} }).run()
  expect(cursors).toEqual([0, 1])
  expect(bootstrapped).toEqual([false, false])
  expect(repository.hasBootstrapped(owner)).toBe(true)
  expect(repository.readSettings(owner)?.unit).toBe('lb')
  db.close()
})

it('aborts an in-flight request on stop without applying data or reporting an error', async () => {
  const { db, repository } = database()
  const states: SyncEngineState[] = []
  let entered!: () => void,
    aborted = false
  const arrived = new Promise<void>((resolve) => {
    entered = resolve
  })
  const api = new ApiClient(
    'https://api.test',
    async () => 'session',
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new DOMException('cancelled', 'AbortError'))
          },
          { once: true },
        )
        entered()
      }),
  )
  const engine = createSyncEngine({
    owner,
    api,
    repository,
    isActive: () => true,
    onState: (s) => states.push(s),
  })
  const running = engine.run()
  await arrived
  engine.stop()
  await running
  expect(aborted).toBe(true)
  expect(states.map((s) => s.state)).toEqual(['syncing'])
  expect(repository.hasBootstrapped(owner)).toBe(false)
  expect(repository.backendUserId(owner)).toBeNull()
  await engine.run()
  expect(states).toHaveLength(1)
  db.close()
})

it('retains the original mapping and pending data if backend identity changes', async () => {
  const { db, repository } = database()
  draft(repository)
  repository.setBackendUserId(owner, backendId)
  const states: SyncEngineState[] = []
  let pulls = 0
  const api = new ApiClient(
    'https://api.test',
    async () => 'session',
    async (url) => {
      if (String(url).endsWith('/users/me')) return response({ id: randomUUID() })
      pulls++
      return response(page())
    },
  )
  await createSyncEngine({
    owner,
    api,
    repository,
    isActive: () => true,
    onState: (s) => states.push(s),
  }).run()
  expect(states.at(-1)?.state).toBe('error')
  expect(pulls).toBe(0)
  expect(repository.backendUserId(owner)).toBe(backendId)
  expect(repository.status(owner).pending).toBe(1)
  db.close()
})
