import { useKeepAwake } from 'expo-keep-awake'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useUserId } from '@/features/auth/use-user-id'
import { useSettings } from '@/features/settings/store'
import { useExerciseNames } from '@/data/exercises'
import { useActiveSession } from '@/data/workout-queries'
import { discardSession, EmptyWorkoutError, finishSession } from '@/data/workouts'
import { domainEvents } from '@/services/events'
import { Button, EmptyState, Loading } from '@/ui'
import { ElapsedTime } from './ElapsedTime'
import { ExerciseBlock } from './ExerciseBlock'
import { RestTimer } from './RestTimer'
import { useRestTimer } from './rest-timer-store'
import { SetEditor } from './SetEditor'
import { toggleSetDone } from './toggle-set-done'

export function ActiveWorkoutScreen() {
  useKeepAwake()
  const userId = useUserId()
  const { data: session, updatedAt } = useActiveSession(userId)
  const names = useExerciseNames()
  const unit = useSettings((s) => s.unit)
  const restSeconds = useSettings((s) => s.restSeconds)
  const stopRest = useRestTimer((s) => s.stop)
  const [finishing, setFinishing] = useState(false)
  const [editing, setEditing] = useState<{ blockId: string; setId: string; label: string } | null>(null)

  if (!updatedAt) return <Loading />
  if (!session) {
    return (
      <SafeAreaView className="flex-1 bg-background p-4">
        <EmptyState title="No workout in progress" />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    )
  }
  const sessionId = session.id
  const editBlock = editing && session.exercises.find((b) => b.id === editing.blockId)
  const editSet = editing && editBlock?.sets.find((x) => x.id === editing.setId)
  const editExercise = editBlock ? names.get(editBlock.exerciseId) : undefined

  async function finish() {
    setFinishing(true)
    try {
      const event = await finishSession(userId, sessionId)
      stopRest()
      domainEvents.emit(event)
      router.replace({
        pathname: '/session/[id]',
        params: { id: sessionId, prs: event.prExerciseIds.join(',') },
      })
    } catch (err) {
      if (err instanceof EmptyWorkoutError) Alert.alert('Nothing to save', err.message)
      else {
        console.error('[workout] finish failed', err)
        Alert.alert('Could not finish workout', 'Your sets are saved. Try again.')
      }
    } finally {
      setFinishing(false)
    }
  }

  function confirmDiscard() {
    Alert.alert('Discard workout?', 'All sets from this workout will be deleted.', [
      { text: 'Keep logging', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          stopRest()
          await discardSession(sessionId)
          router.back()
        },
      },
    ])
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerTitle: () => <ElapsedTime since={session.startedAt} />,
          headerRight: () => <Button label="Finish" size="sm" loading={finishing} onPress={finish} />,
        }}
      />
      <View className="flex-1">
        <ScrollView contentContainerClassName="gap-4 p-4 pb-12" keyboardShouldPersistTaps="handled">
          {session.exercises.length === 0 && (
            <EmptyState title="Add your first exercise" body="Tap a set to log it. Every change autosaves." />
          )}
          {session.exercises.map((block) => (
            <ExerciseBlock
              key={block.id}
              sessionId={sessionId}
              block={block}
              exercise={names.get(block.exerciseId)}
              unit={unit}
              restSeconds={restSeconds}
              onEditSet={(setId, label) => setEditing({ blockId: block.id, setId, label })}
            />
          ))}
          <Button label="Add exercise" variant="secondary" onPress={() => router.push('/add-exercise')} />
          <View className="h-4" />
          <Button label="Discard workout" variant="danger" onPress={confirmDiscard} />
        </ScrollView>
        <RestTimer />
      </View>
      {editing && editBlock && editSet && (
        <SetEditor
          sessionId={sessionId}
          set={editSet}
          title={editing.label === 'W' ? 'Warm-up set' : `Set ${editing.label}`}
          subtitle={editExercise?.name ?? editBlock.exerciseId}
          load={editExercise?.load ?? 'weight'}
          unit={unit}
          onComplete={() => {
            toggleSetDone(sessionId, editSet, restSeconds)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </SafeAreaView>
  )
}
