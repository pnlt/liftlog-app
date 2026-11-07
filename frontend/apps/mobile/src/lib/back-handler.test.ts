import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen'
import { SetEditor } from '@/features/workout/SetEditor'

const runtime = vi.hoisted(() => ({
  platform: 'web',
  handlers: new Set<() => boolean>(),
  closeEditor: vi.fn(),
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Platform: {
    get OS() {
      return runtime.platform
    },
  },
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      if (runtime.platform !== 'android') throw new Error('BackHandler is Android-only')
      runtime.handlers.add(handler)
      return { remove: () => runtime.handlers.delete(handler) }
    },
  },
}))
vi.mock('@clerk/expo', () => ({ useUser: () => ({ user: { firstName: 'Tester' } }) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }))
vi.mock('expo-haptics', () => ({
  selectionAsync: async () => {},
  notificationAsync: async () => {},
  NotificationFeedbackType: { Success: 'success' },
}))
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 } }),
}))
vi.mock('react-native-reanimated', () => {
  const transition = { duration: () => transition, delay: () => transition }
  return {
    default: { View: 'AnimatedView' },
    FadeInDown: transition,
    FadeInLeft: transition,
    FadeInRight: transition,
    FadeOutLeft: transition,
    FadeOutRight: transition,
    useAnimatedStyle: (style: () => unknown) => style(),
    withSpring: (value: number) => value,
  }
})
vi.mock('@/ui/motion', () => ({
  AnimatedStyleView: 'AnimatedStyleView',
  duration: { base: 220, fast: 140 },
  spring: { press: {} },
  fadeIn: {},
  fadeOut: {},
  sheetIn: {},
  sheetOut: {},
}))
vi.mock('@/ui', () =>
  Object.fromEntries(['Button', 'Chip', 'Screen', 'Text', 'PressableScale'].map((name) => [name, name])),
)
vi.mock('@/features/onboarding/fields', () => ({ NumberStepper: 'NumberStepper', Option: 'Option' }))
vi.mock('@/features/profile/PlanSummary', () => ({ PlanSummary: () => null }))
vi.mock('@/features/profile/store', () => ({
  useProfile: (
    selector: (state: { setProfile: () => void; editing: boolean; cancelEditing: () => void }) => unknown,
  ) => selector({ setProfile() {}, editing: false, cancelEditing() {} }),
}))
vi.mock('@/features/settings/store', () => ({
  useSettings: () => ({ unit: 'kg', setUnit() {}, setRestSeconds() {} }),
}))
vi.mock('@/data/workouts', () => ({ updateSet: async () => {} }))

let tree: ReactTestRenderer | undefined
beforeEach(() => {
  runtime.platform = 'web'
  runtime.handlers.clear()
  runtime.closeEditor.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  tree = undefined
  expect(runtime.handlers.size).toBe(0)
  vi.unstubAllGlobals()
})

async function openOnboardingSecondStep() {
  await act(async () => {
    tree = create(createElement(OnboardingScreen))
  })
  await act(async () => {
    tree!.root.findByProps({ label: 'Continue' }).props.onPress()
  })
  expect(JSON.stringify(tree!.toJSON())).toContain('Your sex')
}
async function openEditor() {
  await act(async () => {
    tree = create(
      createElement(SetEditor, {
        userId: 'user_test',
        sessionId: 'session',
        title: 'Set 1',
        subtitle: 'Squat',
        load: 'weight',
        unit: 'kg',
        set: {
          id: 'set',
          workoutExerciseId: 'block',
          position: 0,
          kg: 20,
          reps: 10,
          isWarmup: false,
          completedAt: null,
        },
        onComplete() {},
        onClose: runtime.closeEditor,
      }),
    )
  })
}

it.each(['web', 'ios'])('keeps onboarding navigation usable on %s without BackHandler', async (platform) => {
  runtime.platform = platform
  await openOnboardingSecondStep()
  expect(runtime.handlers.size).toBe(0)
  await act(async () => {
    tree!.root.findByProps({ label: 'Back' }).props.onPress()
  })
  expect(JSON.stringify(tree!.toJSON())).toContain('What should we call you?')
})

it.each(['web', 'ios'])('keeps the set editor usable on %s without BackHandler', async (platform) => {
  runtime.platform = platform
  await openEditor()
  expect(runtime.handlers.size).toBe(0)
  await act(async () => {
    tree!.root.findByProps({ label: 'Close' }).props.onPress()
  })
  expect(runtime.closeEditor).toHaveBeenCalledOnce()
})

it('handles Android hardware Back in onboarding and removes the listener on the first step', async () => {
  runtime.platform = 'android'
  await openOnboardingSecondStep()
  expect(runtime.handlers.size).toBe(1)
  const handler = [...runtime.handlers][0]!
  await act(async () => {
    expect(handler()).toBe(true)
  })
  expect(JSON.stringify(tree!.toJSON())).toContain('What should we call you?')
  expect(runtime.handlers.size).toBe(0)
})

it('closes the set editor with Android hardware Back and removes the listener on unmount', async () => {
  runtime.platform = 'android'
  await openEditor()
  expect(runtime.handlers.size).toBe(1)
  expect([...runtime.handlers][0]!()).toBe(true)
  expect(runtime.closeEditor).toHaveBeenCalledOnce()
})
