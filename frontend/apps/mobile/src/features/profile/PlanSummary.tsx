import Ionicons from '@expo/vector-icons/Ionicons'
import { toDisplay, type Plan, type Unit } from '@liftlog/domain'
import type { ComponentProps } from 'react'
import { View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { formatDuration } from '@/lib/format'
import { Card, Text } from '@/ui'
import colors from '@/ui/colors'
import { duration } from '@/ui/motion'
import { PHASE_LABEL, SPLIT_LABEL } from './labels'

const reveal = (order: number) => FadeInDown.delay(order * 110).duration(duration.slow)

const MACROS = [
  { key: 'proteinG', label: 'Protein', kcal: 4, color: colors.primary.DEFAULT },
  { key: 'carbsG', label: 'Carbs', kcal: 4, color: '#5ac8fa' },
  { key: 'fatG', label: 'Fat', kcal: 9, color: '#ffb340' },
] as const

function Stat({
  icon,
  label,
  value,
}: {
  icon: ComponentProps<typeof Ionicons>['name']
  label: string
  value: string
}) {
  return (
    <View className="flex-1 gap-1 rounded-2xl bg-surface-raised p-3">
      <Ionicons name={icon} size={18} color={colors.primary.DEFAULT} />
      <Text variant="heading">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  )
}

export function PlanSummary({
  plan,
  unit,
  daysPerWeek,
  sessionMinutes,
}: {
  plan: Plan
  unit: Unit
  daysPerWeek: number
  sessionMinutes: number
}) {
  const phase = PHASE_LABEL[plan.phase]
  const split = SPLIT_LABEL[plan.split]
  const change = toDisplay(Math.abs(plan.weeklyChangeKg), unit)
  const changeText =
    plan.weeklyChangeKg === 0
      ? 'Hold weight'
      : `${plan.weeklyChangeKg > 0 ? '+' : '−'}${change} ${unit} / week`

  return (
    <View className="gap-4">
      <Animated.View entering={reveal(0)}>
        <Card className="gap-4 border-primary/40">
          <View className="flex-row items-center justify-between">
            <View className="rounded-full bg-primary px-3 py-1">
              <Text variant="label" className="text-primary-foreground">
                {phase.title}
              </Text>
            </View>
            <Text variant="muted">{changeText}</Text>
          </View>
          <View>
            <Text variant="display">{plan.calories.toLocaleString()}</Text>
            <Text variant="muted">kcal per day · maintenance {plan.tdee.toLocaleString()}</Text>
          </View>
          <Text variant="body" className="text-muted">
            {phase.body}
          </Text>
        </Card>
      </Animated.View>

      <Animated.View entering={reveal(1)}>
        <Card className="gap-3">
          <Text variant="heading">Daily macros</Text>
          <View className="h-3 flex-row gap-1 overflow-hidden rounded-full">
            {MACROS.map((m) => (
              <View key={m.key} style={{ flex: plan[m.key] * m.kcal, backgroundColor: m.color }} />
            ))}
          </View>
          <View className="flex-row gap-3">
            {MACROS.map((m) => (
              <View key={m.key} className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-1.5">
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                  <Text variant="caption">{m.label}</Text>
                </View>
                <Text variant="heading">{plan[m.key]} g</Text>
              </View>
            ))}
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={reveal(2)}>
        <Card className="gap-3">
          <View>
            <Text variant="heading">{split.title}</Text>
            <Text variant="muted">
              {split.body} · {daysPerWeek} days × {sessionMinutes} min
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Stat icon="layers" label="sets / muscle / week" value={String(plan.setsPerMuscle)} />
            <Stat icon="repeat" label="reps per set" value={`${plan.repRange[0]}–${plan.repRange[1]}`} />
            <Stat icon="timer" label="rest" value={formatDuration(plan.restSeconds)} />
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={reveal(3)} className="flex-row gap-3">
        <Stat icon="water" label="water a day" value={`${(plan.waterMl / 1000).toFixed(1)} L`} />
        <Stat
          icon="restaurant"
          label="protein per meal (4 meals)"
          value={`${Math.round(plan.proteinG / 4)} g`}
        />
      </Animated.View>

      <Text variant="caption" className="text-center">
        Estimates from your answers, not medical advice. Check with a doctor before big diet changes.
      </Text>
    </View>
  )
}
