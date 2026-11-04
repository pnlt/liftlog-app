import type { Unit } from '@liftlog/domain'
import { router } from 'expo-router'
import { Alert, Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import type { ExerciseRow } from '@/data/exercises'
import type { SessionWithChildren } from '@/data/workout-queries'
import { addSet, removeExercise } from '@/data/workouts'
import { ExerciseDemo } from '@/features/exercises/ExerciseDemo'
import { Button, Text } from '@/ui'
import { fadeIn, fadeOut, listLayout } from '@/ui/motion'
import { SetRow } from './SetRow'

type Block = SessionWithChildren['exercises'][number]

interface ExerciseBlockProps {
  sessionId: string
  block: Block
  exercise: ExerciseRow | undefined
  unit: Unit
  restSeconds: number
  onEditSet: (setId: string, label: string) => void
}

export function ExerciseBlock({
  sessionId,
  block,
  exercise,
  unit,
  restSeconds,
  onEditSet,
}: ExerciseBlockProps) {
  const load = exercise?.load ?? 'weight'
  let working = 0

  function confirmRemove() {
    Alert.alert('Remove exercise?', 'Its sets in this workout will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeExercise(sessionId, block.id) },
    ])
  }

  return (
    <Animated.View
      entering={fadeIn}
      exiting={fadeOut}
      layout={listLayout}
      className="gap-2 rounded-2xl border border-border bg-surface p-4"
    >
      <View className="flex-row items-center justify-between gap-3">
        {exercise && (
          <Pressable
            onPress={() => router.push(`/exercise/${exercise.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`How to do ${exercise.name}`}
          >
            <ExerciseDemo exercise={exercise} style={{ width: 56, height: 56, borderRadius: 12 }} />
          </Pressable>
        )}
        <Text variant="heading" className="flex-1" numberOfLines={1}>
          {exercise?.name ?? block.exerciseId}
        </Text>
        <Button label="Remove" size="sm" variant="ghost" onPress={confirmRemove} />
      </View>
      <View className="flex-row gap-2 px-1">
        <Text variant="muted" className="w-10 text-center">
          Set
        </Text>
        {load === 'weight' && (
          <Text variant="muted" className="flex-1 text-center">
            {unit}
          </Text>
        )}
        <Text variant="muted" className="flex-1 text-center">
          {load === 'time' ? 'sec' : 'reps'}
        </Text>
        <View className="w-11" />
      </View>
      {block.sets.map((set) => {
        const label = set.isWarmup ? 'W' : String(++working)
        return (
          <SetRow
            key={set.id}
            sessionId={sessionId}
            set={set}
            label={label}
            load={load}
            unit={unit}
            restSeconds={restSeconds}
            onEdit={() => onEditSet(set.id, label)}
          />
        )
      })}
      <Button
        label="Add set"
        size="sm"
        variant="secondary"
        onPress={() => void addSet(sessionId, block.id)}
      />
    </Animated.View>
  )
}
