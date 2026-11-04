import Ionicons from '@expo/vector-icons/Ionicons'
import * as Haptics from 'expo-haptics'
import { useState, type ComponentProps } from 'react'
import { TextInput, View } from 'react-native'
import { PressableScale, Text } from '@/ui'
import colors from '@/ui/colors'

export function Option({
  title,
  body,
  icon,
  selected,
  onPress,
}: {
  title: string
  body: string
  icon?: ComponentProps<typeof Ionicons>['name']
  selected: boolean
  onPress: () => void
}) {
  return (
    <PressableScale
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      className={`min-h-16 flex-row items-center gap-4 rounded-2xl border px-4 py-3 ${
        selected ? 'border-primary bg-primary/10' : 'border-border bg-surface'
      }`}
    >
      {icon && (
        <View
          className={`h-11 w-11 items-center justify-center rounded-xl ${selected ? 'bg-primary' : 'bg-surface-raised'}`}
        >
          <Ionicons name={icon} size={22} color={selected ? colors.primary.foreground : colors.foreground} />
        </View>
      )}
      <View className="flex-1 gap-0.5">
        <Text variant="heading">{title}</Text>
        <Text variant="muted">{body}</Text>
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={selected ? colors.primary.DEFAULT : colors.border}
      />
    </PressableScale>
  )
}

function StepButton({
  icon,
  label,
  onPress,
}: {
  icon: 'remove' | 'add'
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-raised"
    >
      <Ionicons name={icon} size={28} color={colors.foreground} />
    </PressableScale>
  )
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function NumberStepper({
  label,
  unit,
  value,
  step,
  min,
  max,
  decimal = false,
  onChange,
}: {
  label: string
  unit: string
  value: number
  step: number
  min: number
  max: number
  decimal?: boolean
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const bump = (delta: number) => {
    void Haptics.selectionAsync()
    onChange(clamp(Math.round((value + delta) * 10) / 10, min, max))
  }
  return (
    <View className="gap-3">
      <Text variant="label" className="text-muted">
        {label}
      </Text>
      <View className="flex-row items-center gap-3">
        <StepButton icon="remove" label={`${label} minus ${step}`} onPress={() => bump(-step)} />
        <View className="h-16 flex-1 flex-row items-center justify-center gap-1 rounded-2xl bg-surface-raised">
          <TextInput
            value={draft ?? String(value)}
            onChangeText={(text) => {
              setDraft(text)
              const n = Number.parseFloat(text.replace(',', '.'))
              if (Number.isFinite(n)) onChange(n)
            }}
            onFocus={() => setDraft(String(value))}
            onBlur={() => {
              setDraft(null)
              onChange(clamp(value, min, max))
            }}
            keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
            selectTextOnFocus
            accessibilityLabel={`${label} in ${unit}`}
            className="min-w-12 text-center text-3xl font-semibold text-foreground"
          />
          <Text variant="muted">{unit}</Text>
        </View>
        <StepButton icon="add" label={`${label} plus ${step}`} onPress={() => bump(step)} />
      </View>
    </View>
  )
}
