import type { Unit } from '@myos/domain'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import type { ExerciseRow } from '@/data/exercises'
import type { SessionWithChildren } from '@/data/workout-queries'
import { addSet, removeExercise } from '@/data/workouts'
import { ExerciseDemo } from '@/features/exercises/ExerciseDemo'
import { confirmAction, showMessage } from '@/lib/dialogs'
import { Button, Text } from '@/ui'
import { fadeIn, fadeOut, listLayout } from '@/ui/motion'
import { SetRow } from './SetRow'

type Block = SessionWithChildren['exercises'][number]

interface ExerciseBlockProps {
  userId: string
  sessionId: string
  block: Block
  exercise: ExerciseRow | undefined
  unit: Unit
  restSeconds: number
  onEditSet: (setId: string, label: string) => void
}

export function ExerciseBlock({
  userId,
  sessionId,
  block,
  exercise,
  unit,
  restSeconds,
  onEditSet,
}: ExerciseBlockProps) {
  const [removing, setRemoving] = useState(false)
  const load = exercise?.load ?? block.exerciseLoad ?? 'weight'
  let working = 0

  async function confirmRemove() {
    if (removing) return
    setRemoving(true)
    try {
      const confirmed = await confirmAction('Remove exercise?', 'Its sets in this workout will be deleted.', {
        confirmLabel: 'Remove',
        destructive: true,
      })
      if (!confirmed) return
      await removeExercise(userId, sessionId, block.id)
    } catch {
      showMessage('Could not remove exercise', 'Your exercise and sets are saved. Try again.')
    } finally {
      setRemoving(false)
    }
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
          {exercise?.name ?? block.exerciseName ?? block.exerciseId}
        </Text>
        <Button label="Remove" size="sm" variant="ghost" loading={removing} onPress={confirmRemove} />
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
            userId={userId}
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
        onPress={() => void addSet(userId, sessionId, block.id)}
      />
    </Animated.View>
  )
}
