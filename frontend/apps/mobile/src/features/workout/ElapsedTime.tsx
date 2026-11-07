import { formatDuration } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { Text, type TextVariant } from '@/ui/Text'

export function ElapsedTime({ since, variant = 'mono' }: { since: Date; variant?: TextVariant }) {
  const now = useNow()
  const text = formatDuration((now - since.getTime()) / 1000)
  return (
    <Text variant={variant} accessibilityRole="timer" accessibilityLabel={`Elapsed ${text}`}>
      {text}
    </Text>
  )
}
