import { Image, type ImageStyle } from 'expo-image'
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'react-native-reanimated'
import { useSettings } from '@/features/settings/store'
import { LINE_ART } from '@/services/content/demos'
import colors from '@/ui/colors'

const HOLD_MS = 1100

interface DemoExercise {
  id: string
  name: string
  frames: string[]
  imageUrl: string | null
}

export function useDemoFrames(exercise: DemoExercise) {
  const art = useSettings((s) => (s.demoStyle === 'art' ? LINE_ART[exercise.id] : undefined))
  const photos = exercise.frames.length > 0 ? exercise.frames : exercise.imageUrl ? [exercise.imageUrl] : []
  return { frames: art ?? photos, art: art != null }
}

export function ExerciseDemo({
  exercise,
  still = false,
  style,
}: {
  exercise: DemoExercise
  still?: boolean
  style: ImageStyle
}) {
  const { frames, art } = useDemoFrames(exercise)
  const reduceMotion = useReducedMotion()
  const [i, setI] = useState(0)
  const animate = frames.length > 1 && !still && !reduceMotion

  useEffect(() => {
    if (!animate) return
    void Image.prefetch(frames.filter((f) => typeof f === 'string'))
    const timer = setInterval(() => setI((n) => n + 1), HOLD_MS)
    return () => clearInterval(timer)
  }, [animate, frames])

  if (frames.length === 0) return null
  return (
    <Image
      source={frames[animate ? i % frames.length : 0]}
      transition={{ duration: 350, effect: 'cross-dissolve' }}
      contentFit={art ? 'contain' : 'cover'}
      tintColor={art ? colors.foreground : undefined}
      recyclingKey={exercise.id}
      accessible={!still}
      accessibilityLabel={still ? undefined : `${exercise.name} demonstration`}
      style={[{ backgroundColor: colors.surface.raised }, style]}
    />
  )
}
