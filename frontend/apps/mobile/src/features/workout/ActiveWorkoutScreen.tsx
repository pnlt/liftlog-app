import { useKeepAwake } from 'expo-keep-awake'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useUserId } from '@/features/auth/use-user-id'
import { useSettings } from '@/features/settings/store'
import { useExerciseNames } from '@/data/exercises'
import { useActiveSession } from '@/data/workout-queries'
import { discardSession, EmptyWorkoutError, finishSession } from '@/data/workouts'
import { domainEvents } from '@/services/events'
import { confirmAction, showMessage } from '@/lib/dialogs'
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
  const { sessionId: selectedId } = useLocalSearchParams<{ sessionId?: string }>()
  const { data: session, updatedAt } = useActiveSession(userId, selectedId)
  const names = useExerciseNames()
  const unit = useSettings((s) => s.unit)
  const restSeconds = useSettings((s) => s.restSeconds)
  const stopRest = useRestTimer((s) => s.stop)
  const [finishing, setFinishing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
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
    if (finishing || discarding) return
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
      if (err instanceof EmptyWorkoutError) showMessage('Nothing to save', err.message)
      else {
        console.error('[workout] finish failed', err)
        showMessage('Could not finish workout', 'Your sets are saved. Try again.')
      }
    } finally {
      setFinishing(false)
    }
  }

  async function confirmDiscard() {
    if (finishing || discarding) return
    setDiscarding(true)
    try {
      const confirmed = await confirmAction(
        'Discard workout?',
        'All sets from this workout will be deleted.',
        {
          confirmLabel: 'Discard',
          cancelLabel: 'Keep logging',
          destructive: true,
        },
      )
      if (!confirmed) return
      await discardSession(userId, sessionId)
      stopRest()
      router.back()
    } catch {
      showMessage('Could not discard workout', 'Your sets are saved. Try again.')
    } finally {
      setDiscarding(false)
    }
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerTitle: () => <ElapsedTime since={session.startedAt} />,
          headerRight: () => (
            <Button label="Finish" size="sm" loading={finishing} disabled={discarding} onPress={finish} />
          ),
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
              userId={userId}
              sessionId={sessionId}
              block={block}
              exercise={names.get(block.exerciseId)}
              unit={unit}
              restSeconds={restSeconds}
              onEditSet={(setId, label) => setEditing({ blockId: block.id, setId, label })}
            />
          ))}
          <Button
            label="Add exercise"
            variant="secondary"
            onPress={() => router.push({ pathname: '/add-exercise', params: { sessionId } })}
          />
          <View className="h-4" />
          <Button
            label="Discard workout"
            variant="danger"
            loading={discarding}
            disabled={finishing}
            onPress={confirmDiscard}
          />
        </ScrollView>
        <RestTimer />
      </View>
      {editing && editBlock && editSet && (
        <SetEditor
          userId={userId}
          sessionId={sessionId}
          set={editSet}
          title={editing.label === 'W' ? 'Warm-up set' : `Set ${editing.label}`}
          subtitle={editExercise?.name ?? editBlock.exerciseName ?? editBlock.exerciseId}
          load={editExercise?.load ?? editBlock.exerciseLoad ?? 'weight'}
          unit={unit}
          onComplete={() => {
            toggleSetDone(userId, sessionId, editSet, restSeconds)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </SafeAreaView>
  )
}
