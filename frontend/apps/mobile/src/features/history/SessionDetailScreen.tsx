import { toDisplay, volumeKg } from '@myos/domain'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { useExerciseNames } from '@/data/exercises'
import { useSession } from '@/data/workout-queries'
import { deleteSession, toLogged } from '@/data/workouts'
import { useUserId } from '@/features/auth/use-user-id'
import { useSettings } from '@/features/settings/store'
import { confirmAction, showMessage } from '@/lib/dialogs'
import { formatDate, formatDuration, formatNumber } from '@/lib/format'
import { Button, Card, EmptyState, Loading, Screen, Text } from '@/ui'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1">
      <Text variant="muted">{label}</Text>
      <Text variant="heading">{value}</Text>
    </View>
  )
}

export function SessionDetailScreen() {
  const { id, prs } = useLocalSearchParams<{ id: string; prs?: string }>()
  const userId = useUserId()
  const { data: session, updatedAt } = useSession(userId, id)
  const names = useExerciseNames()
  const unit = useSettings((s) => s.unit)
  const [deleting, setDeleting] = useState(false)
  const prIds = new Set(prs ? prs.split(',') : [])

  if (!updatedAt) return <Loading />
  if (!session || session.deletedAt) return <EmptyState title="Workout not found" />

  const working = session.exercises.flatMap((e) => e.sets.filter((s) => !s.isWarmup).map(toLogged))
  const duration = session.endedAt ? (session.endedAt.getTime() - session.startedAt.getTime()) / 1000 : 0

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      const confirmed = await confirmAction('Delete workout?', 'This cannot be undone.', {
        confirmLabel: 'Delete',
        destructive: true,
      })
      if (!confirmed) return
      await deleteSession(userId, id)
      router.back()
    } catch {
      showMessage('Could not delete workout', 'Your workout is saved. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: formatDate(session.startedAt) }} />
      {prIds.size > 0 && (
        <Card className="border-primary">
          <Text variant="heading" className="text-primary">
            {prIds.size === 1 ? 'New personal record' : `${prIds.size} personal records`}
          </Text>
        </Card>
      )}
      <Card className="flex-row">
        <Stat label="Duration" value={formatDuration(duration)} />
        <Stat label="Sets" value={String(working.length)} />
        <Stat label="Volume" value={`${formatNumber(toDisplay(volumeKg(working), unit))} ${unit}`} />
      </Card>
      {session.exercises.map((e) => (
        <Card key={e.id} className="gap-2">
          <Text variant="heading">
            {names.get(e.exerciseId)?.name ?? e.exerciseName ?? e.exerciseId}
            {prIds.has(e.exerciseId) ? '  PR' : ''}
          </Text>
          {e.sets.map((s, i) => (
            <Text key={s.id} variant={s.isWarmup ? 'muted' : 'body'}>
              {s.isWarmup ? 'W' : i + 1}
              {'   '}
              {s.kg != null ? `${toDisplay(s.kg, unit)} ${unit} × ` : ''}
              {s.reps ?? 0}
              {(names.get(e.exerciseId)?.load ?? e.exerciseLoad) === 'time' ? ' s' : ' reps'}
            </Text>
          ))}
        </Card>
      ))}
      {session.endedAt && (
        <Button label="Delete workout" variant="danger" loading={deleting} onPress={confirmDelete} />
      )}
    </Screen>
  )
}
