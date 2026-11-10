import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionWithChildren } from '@/data/workout-queries'
import { EmptyWorkoutError } from '@/data/workouts'
import { SessionDetailScreen } from '@/features/history/SessionDetailScreen'
import { ActiveWorkoutScreen } from './ActiveWorkoutScreen'
import { ExerciseBlock } from './ExerciseBlock'

const runtime = vi.hoisted(() => ({
  confirm: vi.fn(() => true),
  alert: vi.fn(),
  nativeAlert: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  stopRest: vi.fn(),
  discard: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
  finish: vi.fn(),
  emit: vi.fn(),
  session: {
    id: 'workout-1',
    userId: 'owner-1',
    startedAt: new Date('2026-11-07T08:00:00Z'),
    endedAt: new Date('2026-11-07T09:00:00Z'),
    updatedAt: new Date('2026-11-07T09:00:00Z'),
    deletedAt: null,
    note: null,
    exercises: [
      {
        id: 'block-1',
        sessionId: 'workout-1',
        exerciseId: 'squat',
        exerciseName: 'Squat',
        exerciseLoad: 'weight',
        position: 0,
        note: null,
        sets: [
          {
            id: 'set-1',
            workoutExerciseId: 'block-1',
            position: 0,
            kg: 80,
            reps: 5,
            isWarmup: false,
            completedAt: new Date('2026-11-07T08:05:00Z'),
          },
        ],
      },
    ],
  } satisfies SessionWithChildren,
}))

vi.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  Alert: { alert: runtime.nativeAlert },
  Platform: { OS: 'web' },
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('react-native-reanimated', () => ({ default: { View: 'AnimatedView' } }))
vi.mock('expo-keep-awake', () => ({ useKeepAwake: vi.fn() }))
vi.mock('expo-router', () => ({
  router: { back: runtime.back, replace: runtime.replace, push: vi.fn() },
  useLocalSearchParams: () => ({ id: 'workout-1', sessionId: 'workout-1' }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => options.headerRight?.() ?? null,
  },
}))
vi.mock('@/features/auth/use-user-id', () => ({ useUserId: () => 'owner-1' }))
vi.mock('@/features/settings/store', () => ({
  useSettings: (select: (state: { unit: string; restSeconds: number }) => unknown) =>
    select({ unit: 'kg', restSeconds: 90 }),
}))
vi.mock('@/data/exercises', () => ({ useExerciseNames: () => new Map() }))
vi.mock('@/data/workout-queries', () => ({
  useActiveSession: () => ({ data: runtime.session, updatedAt: new Date() }),
  useSession: () => ({ data: runtime.session, updatedAt: new Date() }),
}))
vi.mock('@/data/workouts', () => ({
  discardSession: runtime.discard,
  removeExercise: runtime.remove,
  deleteSession: runtime.delete,
  finishSession: runtime.finish,
  addSet: vi.fn(),
  toLogged: (set: { kg: number | null; reps: number | null }) => ({ kg: set.kg, reps: set.reps ?? 0 }),
  EmptyWorkoutError: class extends Error {},
}))
vi.mock('@/services/events', () => ({ domainEvents: { emit: runtime.emit } }))
vi.mock('@/features/exercises/ExerciseDemo', () => ({ ExerciseDemo: () => null }))
vi.mock('@/ui', () =>
  Object.fromEntries(
    ['Button', 'Card', 'EmptyState', 'Loading', 'Screen', 'Text'].map((name) => [name, name]),
  ),
)
vi.mock('@/ui/motion', () => ({ fadeIn: null, fadeOut: null, listLayout: null }))
vi.mock('./ElapsedTime', () => ({ ElapsedTime: () => null }))
vi.mock('./RestTimer', () => ({ RestTimer: () => null }))
vi.mock('./rest-timer-store', () => ({
  useRestTimer: (select: (state: { stop: () => void }) => unknown) => select({ stop: runtime.stopRest }),
}))
vi.mock('./SetEditor', () => ({ SetEditor: () => null }))
vi.mock('./SetRow', () => ({ SetRow: () => null }))
vi.mock('./toggle-set-done', () => ({ toggleSetDone: vi.fn() }))

let tree: ReactTestRenderer | undefined
beforeEach(() => {
  vi.resetAllMocks()
  runtime.confirm.mockReturnValue(true)
  runtime.discard.mockResolvedValue(undefined)
  runtime.remove.mockResolvedValue(undefined)
  runtime.delete.mockResolvedValue(undefined)
  vi.stubGlobal('confirm', runtime.confirm)
  vi.stubGlobal('alert', runtime.alert)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  tree = undefined
  vi.unstubAllGlobals()
})

async function render(component: ReactElement) {
  await act(async () => {
    tree = create(component)
  })
}
async function press(label: string) {
  await act(async () => {
    await tree!.root.findByProps({ label }).props.onPress()
  })
}

const actions = [
  {
    name: 'discard workout',
    render: () => createElement(ActiveWorkoutScreen),
    button: 'Discard workout',
    title: 'Discard workout?',
    mutation: runtime.discard,
    args: ['owner-1', 'workout-1'],
    navigates: true,
  },
  {
    name: 'remove exercise',
    render: () =>
      createElement(ExerciseBlock, {
        userId: 'owner-1',
        sessionId: 'workout-1',
        block: runtime.session.exercises[0]!,
        exercise: undefined,
        unit: 'kg',
        restSeconds: 90,
        onEditSet: vi.fn(),
      }),
    button: 'Remove',
    title: 'Remove exercise?',
    mutation: runtime.remove,
    args: ['owner-1', 'workout-1', 'block-1'],
    navigates: false,
  },
  {
    name: 'delete workout',
    render: () => createElement(SessionDetailScreen),
    button: 'Delete workout',
    title: 'Delete workout?',
    mutation: runtime.delete,
    args: ['owner-1', 'workout-1'],
    navigates: true,
  },
]

for (const action of actions) {
  describe(action.name, () => {
    it('runs the account-scoped mutation after browser confirmation', async () => {
      await render(action.render())
      await press(action.button)
      expect(runtime.confirm).toHaveBeenCalledWith(expect.stringContaining(action.title))
      expect(action.mutation).toHaveBeenCalledExactlyOnceWith(...action.args)
      expect(runtime.back).toHaveBeenCalledTimes(action.navigates ? 1 : 0)
      expect(runtime.stopRest).toHaveBeenCalledTimes(action.name === 'discard workout' ? 1 : 0)
      expect(runtime.nativeAlert).not.toHaveBeenCalled()
    })

    it('retains the workout and timer when browser confirmation is cancelled', async () => {
      runtime.confirm.mockReturnValue(false)
      await render(action.render())
      await press(action.button)
      expect(runtime.confirm).toHaveBeenCalledOnce()
      expect(action.mutation).not.toHaveBeenCalled()
      expect(runtime.back).not.toHaveBeenCalled()
      expect(runtime.stopRest).not.toHaveBeenCalled()
      expect(JSON.stringify(tree!.toJSON())).toContain('Squat')
      expect(tree!.root.findByProps({ label: action.button }).props.loading).toBe(false)
    })

    it('shows a retry message and retains the screen and timer when saving fails', async () => {
      action.mutation.mockRejectedValueOnce(new Error('Storage unavailable'))
      await render(action.render())
      await press(action.button)
      expect(action.mutation).toHaveBeenCalledOnce()
      expect(runtime.alert).toHaveBeenCalledWith(expect.stringContaining('Try again'))
      expect(runtime.back).not.toHaveBeenCalled()
      expect(runtime.stopRest).not.toHaveBeenCalled()
      expect(JSON.stringify(tree!.toJSON())).toContain('Squat')
      await press(action.button)
      expect(action.mutation).toHaveBeenCalledTimes(2)
    })

    it('prevents duplicate actions and delays navigation until saving succeeds', async () => {
      let resolve!: () => void
      action.mutation.mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolve = done
          }),
      )
      await render(action.render())
      await act(async () => {
        tree!.root.findByProps({ label: action.button }).props.onPress()
      })
      expect(action.mutation).toHaveBeenCalledOnce()
      expect(tree!.root.findByProps({ label: action.button }).props.loading).toBe(true)
      await press(action.button)
      expect(runtime.confirm).toHaveBeenCalledOnce()
      expect(action.mutation).toHaveBeenCalledOnce()
      expect(runtime.back).not.toHaveBeenCalled()
      expect(runtime.stopRest).not.toHaveBeenCalled()
      await act(async () => {
        resolve()
      })
      expect(tree!.root.findByProps({ label: action.button }).props.loading).toBe(false)
      expect(runtime.back).toHaveBeenCalledTimes(action.navigates ? 1 : 0)
      expect(runtime.stopRest).toHaveBeenCalledTimes(action.name === 'discard workout' ? 1 : 0)
    })
  })
}

it.each([
  [new EmptyWorkoutError(), 'Nothing to save'],
  [new Error('Storage unavailable'), 'Could not finish workout'],
])('shows browser feedback when finishing fails: %s', async (error, title) => {
  runtime.finish.mockRejectedValueOnce(error)
  await render(createElement(ActiveWorkoutScreen))
  await press('Finish')
  expect(runtime.alert).toHaveBeenCalledWith(expect.stringContaining(title))
  expect(runtime.stopRest).not.toHaveBeenCalled()
  expect(runtime.emit).not.toHaveBeenCalled()
  expect(runtime.replace).not.toHaveBeenCalled()
  expect(JSON.stringify(tree!.toJSON())).toContain('Squat')
})
