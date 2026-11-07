import type { AlertButton, AlertOptions } from 'react-native'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { confirmAction, showMessage } from './dialogs'

const runtime = vi.hoisted(() => ({
  platform: 'web',
  nativeAlert:
    vi.fn<(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) => void>(),
  confirm: vi.fn(() => true),
  alert: vi.fn(),
}))
vi.mock('react-native', () => ({
  Alert: { alert: runtime.nativeAlert },
  Platform: {
    get OS() {
      return runtime.platform
    },
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  runtime.platform = 'web'
  runtime.confirm.mockReturnValue(true)
  vi.stubGlobal('confirm', runtime.confirm)
  vi.stubGlobal('alert', runtime.alert)
})
afterEach(() => vi.unstubAllGlobals())

it.each([true, false])('returns the browser confirmation decision %s', async (decision) => {
  runtime.confirm.mockReturnValue(decision)
  await expect(
    confirmAction('Delete workout?', 'Your saved workout will be deleted.', {
      confirmLabel: 'Delete',
      destructive: true,
    }),
  ).resolves.toBe(decision)
  expect(runtime.confirm).toHaveBeenCalledWith('Delete workout?\n\nYour saved workout will be deleted.')
  expect(runtime.nativeAlert).not.toHaveBeenCalled()
})

it.each(['android', 'ios'])(
  'resolves native acceptance on %s with the requested labels and destructive style',
  async (platform) => {
    runtime.platform = platform
    const decision = confirmAction('Discard?', 'Discard this workout.', {
      confirmLabel: 'Discard',
      cancelLabel: 'Keep logging',
      destructive: true,
    })
    const buttons = runtime.nativeAlert.mock.calls[0]![2]!
    expect(buttons.map(({ text }) => text)).toEqual(['Keep logging', 'Discard'])
    expect(buttons[1]!.style).toBe('destructive')
    buttons[1]!.onPress!()
    await expect(decision).resolves.toBe(true)
    expect(runtime.confirm).not.toHaveBeenCalled()
  },
)

it('resolves native cancellation without selecting the action', async () => {
  runtime.platform = 'android'
  const decision = confirmAction('Update?', 'Your workouts are kept.', { confirmLabel: 'Start' })
  runtime.nativeAlert.mock.calls[0]![2]![0]!.onPress!()
  await expect(decision).resolves.toBe(false)
})

it('resolves native dismissal as cancellation', async () => {
  runtime.platform = 'android'
  const decision = confirmAction('Update?', 'Your workouts are kept.', { confirmLabel: 'Start' })
  const options = runtime.nativeAlert.mock.calls[0]![3]!
  expect(options.cancelable).toBe(true)
  options.onDismiss!()
  await expect(decision).resolves.toBe(false)
})

it('shows error feedback on web without relying on native Alert', () => {
  showMessage('Could not save', 'Your saved data is kept.')
  expect(runtime.alert).toHaveBeenCalledWith('Could not save\n\nYour saved data is kept.')
  expect(runtime.nativeAlert).not.toHaveBeenCalled()
})

it('shows native error feedback on mobile', () => {
  runtime.platform = 'ios'
  showMessage('Could not save', 'Try again.')
  expect(runtime.nativeAlert).toHaveBeenCalledWith('Could not save', 'Try again.')
  expect(runtime.alert).not.toHaveBeenCalled()
})
