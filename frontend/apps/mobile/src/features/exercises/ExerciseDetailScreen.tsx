import { bestE1rm, toDisplay } from '@myos/domain'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import { View } from 'react-native'
import { useUserId } from '@/features/auth/use-user-id'
import { useSettings } from '@/features/settings/store'
import { useExercise, type ExerciseRow } from '@/data/exercises'
import { useExerciseSets } from '@/data/workout-queries'
import { formatDate } from '@/lib/format'
import { Card, EmptyState, Loading, Screen, Text } from '@/ui'
import { DEMO_VIDEOS } from '@/services/content/demos'
import { ExerciseDemo, useDemoFrames } from './ExerciseDemo'
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from './labels'

function DemoVideo({ source }: { source: string | number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true
    p.muted = true
    p.play()
  })
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 16, overflow: 'hidden' }}
    />
  )
}

function Demo({ exercise }: { exercise: ExerciseRow }) {
  const { frames, art } = useDemoFrames(exercise)
  const clip = DEMO_VIDEOS[exercise.id]
  if (exercise.videoUrl) return <DemoVideo source={exercise.videoUrl} />
  if (clip)
    return (
      <View className="gap-2">
        <DemoVideo source={clip.source} />
        <Text variant="caption">Video: {clip.author} via wger, trimmed · CC BY-SA 4.0</Text>
      </View>
    )
  if (frames.length === 0) return null
  return (
    <View className="gap-2">
      <ExerciseDemo exercise={exercise} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 16 }} />
      <Text variant="caption">
        {art ? 'Illustration: Everkinetic, recoloured · CC BY-SA 4.0' : 'Photos: free-exercise-db'}
      </Text>
    </View>
  )
}

function Progress({ exerciseId }: { exerciseId: string }) {
  const userId = useUserId()
  const unit = useSettings((s) => s.unit)
  const { data } = useExerciseSets(userId, exerciseId)

  const bySession = new Map<string, { startedAt: Date; sets: { kg: number | null; reps: number }[] }>()
  for (const r of data) {
    const entry = bySession.get(r.sessionId) ?? { startedAt: r.startedAt, sets: [] }
    entry.sets.push({ kg: r.kg, reps: r.reps ?? 0 })
    bySession.set(r.sessionId, entry)
  }
  const points = [...bySession.values()]
    .map((s) => ({ date: s.startedAt, e1rm: bestE1rm(s.sets) }))
    .filter((p): p is { date: Date; e1rm: number } => p.e1rm != null)
    .slice(-8)

  if (points.length === 0) return <Text variant="muted">Log this exercise to see your progress.</Text>
  const max = Math.max(...points.map((p) => p.e1rm))

  return (
    <View className="gap-2" accessibilityLabel={`Best estimated one rep max ${toDisplay(max, unit)} ${unit}`}>
      <Text variant="muted">Estimated 1RM, last {points.length} sessions</Text>
      {points.map((p) => (
        <View key={p.date.getTime()} className="flex-row items-center gap-2">
          <Text variant="muted" className="w-24">
            {formatDate(p.date)}
          </Text>
          <View className="h-3 flex-1 overflow-hidden rounded-full bg-surface-raised">
            <View className="h-full rounded-full bg-primary" style={{ width: `${(p.e1rm / max) * 100}%` }} />
          </View>
          <Text variant="label" className="w-16 text-right">
            {toDisplay(p.e1rm, unit)}
          </Text>
        </View>
      ))}
    </View>
  )
}

export function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, updatedAt } = useExercise(id)
  const exercise = data[0]

  if (!updatedAt) return <Loading />
  if (!exercise) return <EmptyState title="Exercise not found" />

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: exercise.name }} />
      <Demo exercise={exercise} />
      <Text variant="muted">
        {exercise.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}
        {exercise.secondaryMuscles.length > 0 &&
          ` · also ${exercise.secondaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}`}
      </Text>
      <Text variant="muted">{exercise.equipment.map((e) => EQUIPMENT_LABELS[e]).join(' · ')}</Text>
      {exercise.instructions.length > 0 && (
        <Card className="gap-3">
          <Text variant="heading">How to</Text>
          {exercise.instructions.map((step, i) => (
            <View key={i} className="flex-row gap-3">
              <Text variant="label" className="text-primary">
                {i + 1}
              </Text>
              <Text variant="body" className="flex-1">
                {step}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {exercise.tips.length > 0 && (
        <Card className="gap-2">
          <Text variant="heading">Tips</Text>
          {exercise.tips.map((tip, i) => (
            <Text key={i} variant="body">
              {tip}
            </Text>
          ))}
        </Card>
      )}
      {exercise.load === 'weight' && (
        <Card className="gap-3">
          <Text variant="heading">Progress</Text>
          <Progress exerciseId={exercise.id} />
        </Card>
      )}
    </Screen>
  )
}
