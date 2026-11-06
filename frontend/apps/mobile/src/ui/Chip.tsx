import { PressableScale } from './PressableScale'
import { Text } from './Text'

interface ChipProps {
  label: string
  active: boolean
  onPress: () => void
  accessibilityLabel?: string
}

export function Chip({ label, active, onPress, accessibilityLabel }: ChipProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      className={`min-h-11 min-w-11 items-center justify-center rounded-full border px-4 ${active ? 'border-primary bg-primary' : 'border-border bg-surface-raised'}`}
    >
      <Text variant="label" className={active ? 'text-primary-foreground' : ''}>
        {label}
      </Text>
    </PressableScale>
  )
}
