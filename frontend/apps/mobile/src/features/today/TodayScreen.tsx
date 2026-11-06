import { useUser } from '@clerk/expo'
import { toDisplay, weeklyBuckets, weekStreak } from '@liftlog/domain'
import { router } from 'expo-router'
import { View } from 'react-native'
import { useUserId } from '@/features/auth/use-user-id'
import { SessionCard } from '@/features/history/SessionCard'
import { useSettings } from '@/features/settings/store'
import { ElapsedTime } from '@/features/workout/ElapsedTime'
import { useStartWorkout } from '@/features/workout/use-start-workout'
import { useActiveSession, useHistory } from '@/data/workout-queries'
import { formatCount, formatNumber } from '@/lib/format'
import { Button, Card, Screen, Text } from '@/ui'
import { FeaturedCarousel } from './FeaturedCarousel'
import { WeeklyVolumeChart } from './WeeklyVolumeChart'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex-1 gap-1">
      <Text variant="muted">{label}</Text>
      <Text variant="heading">{value}</Text>
    </Card>
  )
}

export function TodayScreen() {
  const userId = useUserId()
  const { user } = useUser()
  const unit = useSettings((s) => s.unit)
  const { data: active } = useActiveSession(userId)
  const { data: history } = useHistory(userId)
  const { start, starting } = useStartWorkout(userId)

  const buckets = weeklyBuckets(
    history.map((h) => ({ startedAt: h.startedAt, volumeKg: h.volumeKg })),
    8,
  )
  const thisWeek = buckets[buckets.length - 1]
  const streak = weekStreak(
    history.map((h) => h.startedAt),
    1,
  )

  return (
    <Screen>
      <View className="gap-1">
        <Text variant="muted">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text variant="title">{user?.firstName ? `Hey ${user.firstName}` : 'Today'}</Text>
      </View>

      <FeaturedCarousel />

      {active ? (
        <Card className="gap-3 border-primary">
          <View className="flex-row items-center justify-between">
            <Text variant="heading">Workout in progress</Text>
            <ElapsedTime since={active.startedAt} />
          </View>
          <Button label="Resume workout" onPress={() => router.push('/workout')} />
        </Card>
      ) : (
        <Button label="Start workout" loading={starting} onPress={start} />
      )}

      <View className="flex-row gap-3">
        <Stat label="This week" value={formatCount(thisWeek?.sessions ?? 0, 'workout')} />
        <Stat label="Week streak" value={formatCount(streak, 'week')} />
      </View>

      <Card className="gap-3">
        <View className="flex-row items-baseline justify-between">
          <Text variant="heading">Volume</Text>
          <Text variant="muted">
            {formatNumber(toDisplay(thisWeek?.volumeKg ?? 0, unit))} {unit} this week
          </Text>
        </View>
        <WeeklyVolumeChart buckets={buckets} unit={unit} />
      </Card>

      {history.length > 0 && (
        <View className="gap-3">
          <Text variant="heading">Recent</Text>
          {history.slice(0, 3).map((item) => (
            <SessionCard key={item.id} item={item} unit={unit} />
          ))}
        </View>
      )}
    </Screen>
  )
}
