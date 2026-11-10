import { toDisplay, type Unit, type WeekBucket } from '@myos/domain'
import { View } from 'react-native'
import { formatNumber } from '@/lib/format'
import { Text } from '@/ui'

export function WeeklyVolumeChart({ buckets, unit }: { buckets: WeekBucket[]; unit: Unit }) {
  const max = Math.max(1, ...buckets.map((b) => b.volumeKg))
  const summary = buckets
    .map((b) => `${b.weekStart.toLocaleDateString()}: ${formatNumber(toDisplay(b.volumeKg, unit))} ${unit}`)
    .join(', ')

  return (
    <View
      accessible
      accessibilityLabel={`Weekly volume. ${summary}`}
      className="h-28 flex-row items-end gap-2"
    >
      {buckets.map((b, i) => (
        <View key={b.weekStart.getTime()} className="flex-1 items-center gap-1">
          <View
            className={`w-full rounded-md ${i === buckets.length - 1 ? 'bg-primary' : 'bg-surface-raised'}`}
            style={{ height: Math.max(4, (b.volumeKg / max) * 88) }}
          />
          <Text variant="caption">
            {b.weekStart.getDate()}/{b.weekStart.getMonth() + 1}
          </Text>
        </View>
      ))}
    </View>
  )
}
