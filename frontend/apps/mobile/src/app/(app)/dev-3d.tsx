import { useState } from 'react'
import { View } from 'react-native'
import { Exercise3DDemo, exerciseAnimation } from '@/features/exercises/Exercise3DDemo'
import { MUSCLE_LABELS } from '@/features/exercises/labels'
import { SEED_EXERCISES } from '@/services/content/seed'
import { Chip, Screen, Text } from '@/ui'

const ANIMATED = SEED_EXERCISES.filter((e) => exerciseAnimation(e.id))

export default function Dev3DRoute() {
  const [id, setId] = useState('db-curl')
  const exercise = ANIMATED.find((e) => e.id === id)
  if (!exercise) return null
  return (
    <Screen>
      <Text variant="title">{exercise.name}</Text>
      <Exercise3DDemo
        animation={exerciseAnimation(exercise.id) ?? exercise.id}
        highlights={exercise.primaryMuscles}
      />
      <Text variant="caption">
        {exercise.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')} highlighted · drag to rotate
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {ANIMATED.map((e) => (
          <Chip key={e.id} label={e.name} active={e.id === id} onPress={() => setId(e.id)} />
        ))}
      </View>
    </Screen>
  )
}
