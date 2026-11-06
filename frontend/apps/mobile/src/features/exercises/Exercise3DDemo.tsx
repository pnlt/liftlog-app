/* eslint-disable react-hooks/immutability -- worklets-core shared values are written through `.value`; there is no setter method. */
import { useCallback } from 'react'
import { View } from 'react-native'
import {
  Animator,
  Camera,
  DefaultLight,
  FilamentScene,
  FilamentView,
  type FrameInfo,
  ModelRenderer,
  useFilamentContext,
  useModel,
} from 'react-native-filament'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import { useReducedMotion } from 'react-native-reanimated'
import { useSharedValue } from 'react-native-worklets-core'

const DRAG_RADIANS_PER_POINT = 0.01
const RETURN_RATE = 4

function Scene({ source }: { source: number }) {
  const reducedMotion = useReducedMotion()
  const model = useModel(source)
  const { transformManager } = useFilamentContext()
  const root = model.state === 'loaded' ? model.rootEntity : undefined
  const yaw = useSharedValue(0)
  const appliedYaw = useSharedValue(Number.NaN)
  const dragging = useSharedValue(false)
  const dragStart = useSharedValue(0)

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

  // Not Model's shared-value `rotate`: Reanimated's babel plugin breaks filament's worklet helpers.
  const renderCallback = useCallback(
    ({ timeSinceLastFrame }: FrameInfo) => {
      'worklet'
      if (root == null) return
      if (!dragging.value && yaw.value !== 0) {
        const next = yaw.value * Math.exp(-RETURN_RATE * Math.min(timeSinceLastFrame, 0.1))
        yaw.value = Math.abs(next) < 0.001 ? 0 : next
      }
      if (yaw.value === appliedYaw.value) return
      transformManager.setEntityRotation(root, yaw.value, [0, 1, 0], false)
      appliedYaw.value = yaw.value
    },
    [root, transformManager, yaw, appliedYaw, dragging],
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
          <ModelRenderer model={model}>{!reducedMotion && <Animator animationIndex={0} />}</ModelRenderer>
          <Camera cameraPosition={[1.45, 1.35, 2.15]} cameraTarget={[0, 0.95, 0]} />
        </FilamentView>
      </View>
    </GestureDetector>
  )
}

export function Exercise3DDemo({ source }: { source: number }) {
  return (
    <FilamentScene bloomOptions={{ enabled: true, strength: 0.2 }}>
      <Scene source={source} />
    </FilamentScene>
  )
}
