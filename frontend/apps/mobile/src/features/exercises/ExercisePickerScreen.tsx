import { router, useLocalSearchParams } from 'expo-router'
import { Alert } from 'react-native'
import { useUserId } from '@/features/auth/use-user-id'
import { useActiveSession } from '@/data/workout-queries'
import { addExercise } from '@/data/workouts'
import { Screen } from '@/ui'
import { ExerciseList } from './ExerciseList'

export function ExercisePickerScreen() {
  const userId = useUserId()
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>()
  const { data: session } = useActiveSession(userId, sessionId)

  return (
    <Screen scroll={false} edges={[]}>
      <ExerciseList
        onSelect={async (e) => {
          if (!session) return router.back()
          try {
            await addExercise(userId, session.id, e.id)
            router.back()
          } catch (err) {
            console.error('[workout] add exercise failed', err)
            Alert.alert('Could not add exercise', 'Please try again.')
          }
        }}
      />
    </Screen>
  )
}
