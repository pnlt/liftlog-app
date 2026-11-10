import type { Muscle } from '@myos/domain'
import { router, useLocalSearchParams } from 'expo-router'
import { Screen } from '@/ui'
import { ExerciseList } from './ExerciseList'

export function ExerciseLibraryScreen() {
  const { muscle } = useLocalSearchParams<{ muscle?: Muscle }>()
  return (
    <Screen scroll={false} edges={[]}>
      {/* Remount on a new deep-linked muscle so the filter resets to it. */}
      <ExerciseList
        key={muscle}
        initialMuscle={muscle}
        onSelect={(e) => router.push({ pathname: '/exercise/[id]', params: { id: e.id } })}
      />
    </Screen>
  )
}
