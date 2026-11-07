import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SyncedSettings } from '@myos/contracts'
import type { useSynchronization } from '@/services/sync/SyncProvider'
import { accountDatabase } from '../profile/sqlite.test-helper'
import { SyncStatus } from './SyncStatus'

type SyncView = NonNullable<ReturnType<typeof useSynchronization>>
const runtime = vi.hoisted(() => ({
  view: null as SyncView | null,
  confirm: vi.fn(() => true),
  alert: vi.fn(),
}))
vi.mock('react-native', () => ({ View: 'View', Platform: { OS: 'web' }, Alert: { alert() {} } }))
vi.mock('@/ui', () => Object.fromEntries(['Button', 'Card', 'Text'].map((name) => [name, name])))
vi.mock('@/services/sync/SyncProvider', () => ({ useSynchronization: () => runtime.view }))

const owner = 'user_dialog_test'
const local: SyncedSettings = { unit: 'kg', restSeconds: 90, demoStyle: 'art', timeZone: 'UTC' }
const server: SyncedSettings = { ...local, unit: 'lb', restSeconds: 120 }
const labels = { local: 'Keep this device’s version', server: 'Use account version' }
let database: ReturnType<typeof accountDatabase>
let tree: ReactTestRenderer | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('confirm', runtime.confirm)
  vi.stubGlobal('alert', runtime.alert)
  runtime.confirm.mockReturnValue(true)
  database = accountDatabase()
  const repository = database.repository
  repository.saveSettings(owner, local)
  const mutation = repository.next(owner)!
  repository.conflict(owner, mutation.mutationId, {
    entityType: 'settings',
    entityId: 'self',
    version: 1,
    revision: 1,
    mutationId: randomUUID(),
    operation: 'upsert',
    payload: server,
  })
  runtime.view = {
    state: 'idle',
    message: null,
    pending: 0,
    lastSyncedAt: null,
    conflicts: repository.listConflicts(owner),
    retry() {},
    resolve: (conflict, choice) => repository.resolve(owner, conflict.entityType, conflict.entityId, choice),
  }
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  tree = undefined
  database.db.close()
  vi.unstubAllGlobals()
})
const outbox = () => database.db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all()
async function press(label: string) {
  await act(async () => {
    tree = create(createElement(SyncStatus))
  })
  await act(async () => {
    tree!.root.findByProps({ label }).props.onPress()
  })
}

it.each(['local', 'server'] as const)(
  'preserves the draft and frozen intent when %s confirmation is cancelled',
  async (choice) => {
    runtime.confirm.mockReturnValue(false)
    const before = outbox()
    await press(labels[choice])
    expect(runtime.confirm).toHaveBeenCalledOnce()
    expect(outbox()).toEqual(before)
    expect(database.repository.readSettings(owner)).toEqual(local)
    expect(database.repository.listConflicts(owner)).toHaveLength(1)
  },
)

it('creates a fresh mutation at the current server version after choosing the local version', async () => {
  const previous = runtime.view!.conflicts[0]!.mutationId
  await press(labels.local)
  const mutation = database.repository.next(owner)!
  expect(mutation).not.toBeNull()
  expect(mutation.mutationId).not.toBe(previous)
  expect(mutation.baseVersion).toBe(1)
  expect(mutation.payload).toEqual(local)
  expect(database.repository.listConflicts(owner)).toHaveLength(0)
})

it('uses the account version only after explicit confirmation', async () => {
  await press(labels.server)
  expect(runtime.confirm).toHaveBeenCalledWith(
    expect.stringContaining('replaces this device’s unsent version'),
  )
  expect(database.repository.readSettings(owner)).toEqual(server)
  expect(outbox()).toHaveLength(0)
})

it.each(['local', 'server'] as const)(
  'shows a web error and preserves the conflict when %s resolution cannot commit',
  async (choice) => {
    database.db.exec(
      "CREATE TRIGGER block_resolution BEFORE DELETE ON sync_outbox BEGIN SELECT RAISE(ABORT, 'test write failure'); END",
    )
    const before = outbox()
    await press(labels[choice])
    expect(runtime.alert).toHaveBeenCalledWith(expect.stringContaining('Your saved data has been kept'))
    expect(outbox()).toEqual(before)
    expect(database.repository.listConflicts(owner)).toHaveLength(1)
  },
)
