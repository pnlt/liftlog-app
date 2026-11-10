/* eslint-disable react-hooks/immutability -- worklets-core shared values are written through `.value`; there is no setter method. */
import type { Muscle } from '@myos/domain'
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import {
  Camera,
  DefaultLight,
  FilamentScene,
  FilamentView,
  type Float4,
  type FrameInfo,
  ModelRenderer,
  useAnimator,
  useFilamentContext,
  useModel,
} from 'react-native-filament'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import { useReducedMotion } from 'react-native-reanimated'
import { useSharedValue } from 'react-native-worklets-core'
import exercisesGlb from '@/assets/models/exercises.glb'

const DRAG_RADIANS_PER_POINT = 0.01
const RETURN_RATE = 4
const HIGHLIGHT: [number, number, number] = [0.1, 1, 0.25]
const GLOW: [number, number, number] = [0.06, 0.6, 0.15]

const ANIMATIONS = [
  'db-curl',
  'barbell-curl',
  'hammer-curl',
  'overhead-press',
  'db-shoulder-press',
  'lateral-raise',
  'overhead-triceps-extension',
  'db-shrug',
  'goblet-squat',
  'back-squat',
  'front-squat',
  'bodyweight-squat',
  'romanian-deadlift',
  'db-rdl',
  'deadlift',
  'kb-swing',
  'standing-calf-raise',
]

const ALIASES: Partial<Record<string, string>> = {
  'fedb-dumbbell-bicep-curl': 'db-curl',
  'fedb-hammer-curls': 'hammer-curl',
  'fedb-standing-military-press': 'overhead-press',
  'fedb-barbell-shoulder-press': 'overhead-press',
  'fedb-standing-dumbbell-press': 'db-shoulder-press',
  'fedb-side-lateral-raise': 'lateral-raise',
  'fedb-standing-dumbbell-triceps-extension': 'overhead-triceps-extension',
  'fedb-barbell-squat': 'back-squat',
  'fedb-barbell-full-squat': 'back-squat',
  'fedb-front-barbell-squat': 'front-squat',
  'fedb-front-squat-clean-grip': 'front-squat',
  'fedb-barbell-deadlift': 'deadlift',
  'fedb-stiff-legged-barbell-deadlift': 'romanian-deadlift',
  'fedb-stiff-legged-dumbbell-deadlift': 'db-rdl',
}

export function exerciseAnimation(exerciseId: string) {
  return ALIASES[exerciseId] ?? (ANIMATIONS.includes(exerciseId) ? exerciseId : undefined)
}

type Props = { animation: string; highlights: readonly Muscle[] }

function Scene({ animation, highlights }: Props) {
  const reducedMotion = useReducedMotion()
  const model = useModel(exercisesGlb)
  const animator = useAnimator(model)
  const { transformManager, renderableManager } = useFilamentContext()
  const asset = model.state === 'loaded' ? model.asset : undefined
  const root = model.state === 'loaded' ? model.rootEntity : undefined
  const yaw = useSharedValue(0)
  const appliedYaw = useSharedValue(Number.NaN)
  const dragging = useSharedValue(false)
  const dragStart = useSharedValue(0)
  const paintedFor = useSharedValue('')
  const muscleColor = useSharedValue<Float4 | null>(null)
  const materials = useMemo(() => highlights.map((m) => `muscle:${m}`), [highlights])
  const paintKey = materials.join()

  const animationIndex = useMemo(() => {
    if (animator == null) return -1
    for (let i = 0; i < animator.getAnimationCount(); i++)
      if (animator.getAnimationName(i) === animation) return i
    return -1
  }, [animator, animation])

  const pan = usePanGesture({
    runOnJS: true,
    onBegin: () => {
      dragging.value = true
      dragStart.value = yaw.value
    },
    onUpdate: (e) => {
      yaw.value = dragStart.value + e.translationX * DRAG_RADIANS_PER_POINT
    },
    onFinalize: () => {
      dragging.value = false
    },
  })

  // Not Model's shared-value `rotate` or <Animator>: Reanimated's babel plugin breaks filament's worklet helpers.
  const renderCallback = useCallback(
    ({ timeSinceLastFrame, passedSeconds }: FrameInfo) => {
      'worklet'
      if (root == null || asset == null || animator == null || animationIndex < 0) return
      if (paintedFor.value !== paintKey) {
        const body = asset.getFirstEntityByName('Body')
        if (body != null) {
          for (let i = 0; i < renderableManager.getPrimitiveCount(body); i++) {
            const material = renderableManager.getMaterialInstanceAt(body, i)
            if (!material.getName.startsWith('muscle:')) continue
            muscleColor.value ??= material.getFloat4Parameter('baseColorFactor')
            const lit = materials.includes(material.getName)
            material.setFloat4Parameter('baseColorFactor', lit ? [...HIGHLIGHT, 1] : muscleColor.value)
            material.setFloat3Parameter('emissiveFactor', lit ? GLOW : [0, 0, 0])
          }
        }
        paintedFor.value = paintKey
      }
      animator.applyAnimation(animationIndex, reducedMotion ? 0 : passedSeconds)
      animator.updateBoneMatrices()
      if (!dragging.value && yaw.value !== 0) {
        const next = yaw.value * Math.exp(-RETURN_RATE * Math.min(timeSinceLastFrame, 0.1))
        yaw.value = Math.abs(next) < 0.001 ? 0 : next
      }
      if (yaw.value === appliedYaw.value) return
      transformManager.setEntityRotation(root, yaw.value, [0, 1, 0], false)
      appliedYaw.value = yaw.value
    },
    [
      root,
      asset,
      animator,
      animationIndex,
      reducedMotion,
      materials,
      paintKey,
      renderableManager,
      transformManager,
      yaw,
      appliedYaw,
      dragging,
      paintedFor,
      muscleColor,
    ],
  )

  return (
    <GestureDetector gesture={pan}>
      <View
        className="aspect-square w-full overflow-hidden rounded-2xl bg-surface"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="3D exercise demo, drag to rotate"
      >
        <FilamentView style={{ flex: 1 }} renderCallback={renderCallback}>
          <DefaultLight />
          <ModelRenderer model={model} />
          <Camera cameraPosition={[1.7, 1.45, 2.55]} cameraTarget={[0, 1.0, 0]} />
        </FilamentView>
      </View>
    </GestureDetector>
  )
}

export function Exercise3DDemo(props: Props) {
  return (
    <FilamentScene bloomOptions={{ enabled: true, strength: 0.2 }}>
      <Scene {...props} />
    </FilamentScene>
  )
}
