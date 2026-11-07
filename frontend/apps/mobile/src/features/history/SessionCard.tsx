import type { Unit } from '@myos/domain'
import { toDisplay } from '@myos/domain'
import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import type { HistoryItem } from '@/data/workout-queries'
import { formatCount, formatDate, formatDuration, formatNumber } from '@/lib/format'
import { Text } from '@/ui'

export function SessionCard({ item, unit }: { item: HistoryItem; unit: Unit }) {
  const duration = item.endedAt ? (item.endedAt.getTime() - item.startedAt.getTime()) / 1000 : 0
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.id } })}
      accessibilityRole="button"
      className="gap-1 rounded-2xl border border-border bg-surface p-4 active:opacity-70"
    >
      <Text variant="label">{formatDate(item.startedAt)}</Text>
      <View className="flex-row gap-4">
        <Text variant="muted">{formatDuration(duration)}</Text>
        <Text variant="muted">{formatCount(item.exercises, 'exercise')}</Text>
        <Text variant="muted">{formatCount(item.sets, 'set')}</Text>
        <Text variant="muted">
          {formatNumber(toDisplay(item.volumeKg, unit))} {unit}
        </Text>
      </View>
    </Pressable>
  )
}
