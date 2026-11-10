import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { syncRepository } from '@/data/sync'
import { SyncProvider } from './SyncProvider'

const runtime = vi.hoisted(() => ({
  userId: null as string | null,
  appState: 'active',
  foreground: (_state: string) => {},
  getToken: vi.fn(async () => 'isolated-test-token'),
}))
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: runtime.userId, isLoaded: true, getToken: runtime.getToken }),
  useClerk: () => ({ signOut: async () => {} }),
}))
vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID }))
vi.mock('expo-sqlite/kv-store', () => ({ default: { getItemSync: () => null } }))
vi.mock('react-native', () => ({
  View: 'View',
  AppState: {
    get currentState() {
      return runtime.appState
    },
    addEventListener: (_type: string, listener: typeof runtime.foreground) => {
      runtime.foreground = listener
      return { remove() {} }
    },
  },
}))
vi.mock('@/ui', () =>
  Object.fromEntries(['Button', 'Card', 'Loading', 'Screen', 'Text'].map((name) => [name, name])),
)
vi.mock('@/data/exercises', () => ({ upsertExercises: async () => {} }))
vi.mock('../content/backend', () => ({ fetchBackendCatalog: async () => [] }))
vi.mock('@/features/workout/rest-timer-store', () => ({ useRestTimer: { getState: () => ({ stop() {} }) } }))
vi.mock('@/lib/env', () => ({ envResult: { success: true, data: { apiUrl: 'https://api.test' } } }))
vi.mock('@/data/sync', async () => {
  const { accountDatabase } = await import('../../features/profile/sqlite.test-helper')
  return { syncRepository: accountDatabase().repository }
})

let tree: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  runtime.userId = null
  runtime.appState = 'active'
  runtime.getToken.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', async function (this: unknown, url: string) {
    if (this !== globalThis) throw new TypeError('Browser fetch requires the Window receiver')
    return Response.json(
      url.endsWith('/users/me')
        ? { id: '11111111-1111-4111-8111-111111111111' }
        : { changes: [], nextCursor: 0, hasMore: false },
    )
  })
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('restores the account after the signed-out view becomes signed in', async () => {
  await act(async () => {
    tree = create(createElement(SyncProvider, null, 'RESTORED'))
  })
  runtime.userId = 'user_provider_sign_in'
  await act(async () => {
    tree!.update(createElement(SyncProvider, null, 'RESTORED'))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(syncRepository.hasBootstrapped(runtime.userId)).toBe(true)
  expect(JSON.stringify(tree!.toJSON())).toContain('RESTORED')
})

it('restores when returning from OAuth in a background tab', async () => {
  runtime.userId = 'user_provider_foreground'
  runtime.appState = 'background'
  await act(async () => {
    tree = create(createElement(SyncProvider, null, 'RESTORED'))
  })
  runtime.appState = 'active'
  await act(async () => {
    runtime.foreground('active')
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(syncRepository.hasBootstrapped(runtime.userId)).toBe(true)
})

it('restores after the user retries a failed first connection', async () => {
  runtime.userId = 'user_provider_retry'
  let online = false
  vi.stubGlobal('fetch', async function (this: unknown, url: string) {
    if (this !== globalThis) throw new TypeError('Browser fetch requires the Window receiver')
    if (!online) throw new TypeError('Network unavailable')
    return Response.json(
      url.endsWith('/users/me')
        ? { id: '11111111-1111-4111-8111-111111111111' }
        : { changes: [], nextCursor: 0, hasMore: false },
    )
  })
  await act(async () => {
    tree = create(createElement(SyncProvider, null, 'RESTORED'))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(syncRepository.hasBootstrapped(runtime.userId)).toBe(false)
  expect(JSON.stringify(tree!.toJSON())).toContain('Synchronization will retry')
  online = true
  await act(async () => {
    tree!.root.findByProps({ label: 'Connect and restore' }).props.onPress()
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(syncRepository.hasBootstrapped(runtime.userId)).toBe(true)
  expect(JSON.stringify(tree!.toJSON())).toContain('RESTORED')
})
