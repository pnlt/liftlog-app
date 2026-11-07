import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProfileScreen } from './ProfileScreen'

const runtime = vi.hoisted(() => ({
  platform: 'web',
  signOut: vi.fn(async () => {}),
  confirm: vi.fn(() => true),
  alert: vi.fn(),
  clearProfile: vi.fn(),
}))
vi.mock('@clerk/expo', () => ({
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: runtime.signOut }),
}))
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }))
vi.mock('expo-image', () => ({ Image: 'Image' }))
vi.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
  Alert: { alert: runtime.alert },
  Platform: {
    get OS() {
      return runtime.platform
    },
  },
}))
vi.mock('@/features/settings/store', () => ({
  useSettings: () => ({ unit: 'kg', restSeconds: 90, demoStyle: 'art' }),
}))
vi.mock('@/features/sync/SyncStatus', () => ({ SyncStatus: () => null }))
vi.mock('./PlanSummary', () => ({ PlanSummary: () => null }))
vi.mock('./store', () => ({
  useProfile: () => ({ profile: null, clearProfile: runtime.clearProfile }),
  usePlan: () => null,
}))
vi.mock('@/ui', () => Object.fromEntries(['Button', 'Card', 'Screen', 'Text'].map((name) => [name, name])))

let tree: ReactTestRenderer
beforeEach(async () => {
  vi.resetAllMocks()
  runtime.platform = 'web'
  runtime.signOut.mockResolvedValue(undefined)
  runtime.confirm.mockReturnValue(true)
  vi.stubGlobal('confirm', runtime.confirm)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await act(async () => {
    tree = create(createElement(ProfileScreen))
  })
})
afterEach(async () => {
  await act(async () => tree.unmount())
  vi.unstubAllGlobals()
})
const signOutButton = () => tree.root.findByProps({ label: 'Sign out' })

it('opens plan editing on web only after confirmation', async () => {
  await act(async () => {
    tree.root.findByProps({ label: 'Update my plan' }).props.onPress()
  })
  expect(runtime.confirm).toHaveBeenCalledWith(expect.stringContaining('Your workouts are kept'))
  expect(runtime.clearProfile).toHaveBeenCalledOnce()
  expect(runtime.signOut).not.toHaveBeenCalled()
})

it('keeps the current plan when its web confirmation is cancelled', async () => {
  runtime.confirm.mockReturnValue(false)
  await act(async () => {
    tree.root.findByProps({ label: 'Update my plan' }).props.onPress()
  })
  expect(runtime.confirm).toHaveBeenCalledOnce()
  expect(runtime.clearProfile).not.toHaveBeenCalled()
})

it('signs out on web after confirming without clearing the saved profile', async () => {
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(runtime.confirm).toHaveBeenCalledWith(expect.stringContaining('Unsent changes stay on this device'))
  expect(runtime.signOut).toHaveBeenCalledOnce()
  expect(runtime.clearProfile).not.toHaveBeenCalled()
})

it('keeps the session when web confirmation is cancelled', async () => {
  runtime.confirm.mockReturnValue(false)
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(runtime.confirm).toHaveBeenCalledOnce()
  expect(runtime.signOut).not.toHaveBeenCalled()
})

it('shows a retryable message when Clerk cannot sign out', async () => {
  runtime.signOut.mockRejectedValueOnce(new Error('Network unavailable'))
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(JSON.stringify(tree.toJSON())).toContain('Could not sign out')
  expect(signOutButton().props.loading).toBe(false)
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(runtime.signOut).toHaveBeenCalledTimes(2)
})

it('retains the native confirmation before signing out', async () => {
  runtime.platform = 'android'
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(runtime.confirm).not.toHaveBeenCalled()
  expect(runtime.signOut).not.toHaveBeenCalled()
  const buttons = runtime.alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[]
  await act(async () => {
    buttons.find((button) => button.text === 'Sign out')!.onPress!()
  })
  expect(runtime.signOut).toHaveBeenCalledOnce()
})

it('shows progress and prevents another sign out while the request is pending', async () => {
  let finish!: () => void
  runtime.signOut.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(signOutButton().props.loading).toBe(true)
  await act(async () => {
    signOutButton().props.onPress()
  })
  expect(runtime.signOut).toHaveBeenCalledOnce()
  await act(async () => {
    finish()
  })
  expect(signOutButton().props.loading).toBe(false)
})
