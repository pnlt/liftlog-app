import Ionicons from '@expo/vector-icons/Ionicons'
import {
  DEFAULT_WEIGHT_STEP,
  fromDisplay,
  stepValue,
  toDisplay,
  WEIGHT_STEPS,
  type Load,
  type Unit,
} from '@myos/domain'
import * as Haptics from 'expo-haptics'
import { useEffect, useState, type ReactNode } from 'react'
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import Animated from 'react-native-reanimated'
import type { WorkoutSetRow } from '@/data/db/schema'
import { updateSet } from '@/data/workouts'
import { Button, Chip, PressableScale, Text } from '@/ui'
import colors from '@/ui/colors'
import { fadeIn, fadeOut, sheetIn, sheetOut } from '@/ui/motion'

const REP_PICKS = [3, 5, 6, 8, 10, 12, 15, 20]
const SECOND_PICKS = [20, 30, 45, 60, 90, 120]

const parse = (text: string) => {
  const n = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Typing saves per keystroke: the sheet can unmount before blur fires. */
function ValueInput({
  value,
  onCommit,
  label,
  decimal,
}: {
  value: number | null
  onCommit: (v: number | null) => void
  label: string
  decimal: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <TextInput
      value={draft ?? (value == null ? '' : String(value))}
      onChangeText={(text) => {
        setDraft(text)
        onCommit(parse(text))
      }}
      onFocus={() => setDraft(value == null ? '' : String(value))}
      onBlur={() => setDraft(null)}
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
      selectTextOnFocus
      placeholder="0"
      placeholderTextColor={colors.muted}
      accessibilityLabel={label}
      accessibilityHint="Type a value or use the minus and plus buttons"
      className="h-16 flex-1 rounded-2xl bg-surface-raised text-center text-3xl font-semibold text-foreground"
    />
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

function Stepper({
  label,
  value,
  step,
  decimal,
  onChange,
  children,
}: {
  label: string
  value: number | null
  step: number
  decimal: boolean
  onChange: (v: number | null) => void
  children: ReactNode
}) {
  const bump = (delta: number) => {
    void Haptics.selectionAsync()
    onChange(stepValue(value, delta))
  }
  return (
    <View className="gap-3">
      <Text variant="label" className="text-muted">
        {label}
      </Text>
      <View className="flex-row items-center gap-3">
        <StepButton icon="remove" label={`${label} minus ${step}`} onPress={() => bump(-step)} />
        <ValueInput value={value} decimal={decimal} label={label} onCommit={onChange} />
        <StepButton icon="add" label={`${label} plus ${step}`} onPress={() => bump(step)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {children}
      </ScrollView>
    </View>
  )
}

interface SetEditorProps {
  userId: string
  sessionId: string
  set: WorkoutSetRow
  title: string
  subtitle: string
  load: Load
  unit: Unit
  onComplete: () => void
  onClose: () => void
}

export function SetEditor({
  userId,
  sessionId,
  set,
  title,
  subtitle,
  load,
  unit,
  onComplete,
  onClose,
}: SetEditorProps) {
  const [step, setStep] = useState(DEFAULT_WEIGHT_STEP[unit])
  const done = set.completedAt != null
  const weight = set.kg == null ? null : toDisplay(set.kg, unit)
  const repsLabel = load === 'time' ? 'Seconds' : 'Reps'

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [onClose])

  const writeWeight = (v: number | null) =>
    void updateSet(userId, sessionId, set.id, { kg: v == null ? null : fromDisplay(v, unit) })
  const writeReps = (v: number | null) =>
    void updateSet(userId, sessionId, set.id, { reps: v == null ? null : Math.round(v) })

  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.backdrop]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close set editor"
        />
      </Animated.View>
      <Animated.View
        entering={sheetIn}
        exiting={sheetOut}
        accessibilityViewIsModal
        className="gap-6 rounded-t-3xl border-t border-border bg-surface px-5 pb-8 pt-3"
      >
        <View className="h-1 w-10 self-center rounded-full bg-border" />
        <View>
          <Text variant="heading">{title}</Text>
          <Text variant="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>

        {load === 'weight' && (
          <Stepper label={`Weight (${unit})`} value={weight} step={step} decimal onChange={writeWeight}>
            {WEIGHT_STEPS[unit].map((s) => (
              <Chip
                key={s}
                label={`±${s}`}
                accessibilityLabel={`Step by ${s} ${unit}`}
                active={s === step}
                onPress={() => setStep(s)}
              />
            ))}
          </Stepper>
        )}

        <Stepper
          label={repsLabel}
          value={set.reps}
          step={load === 'time' ? 5 : 1}
          decimal={false}
          onChange={writeReps}
        >
          {(load === 'time' ? SECOND_PICKS : REP_PICKS).map((n) => (
            <Chip
              key={n}
              label={String(n)}
              accessibilityLabel={`${n} ${repsLabel.toLowerCase()}`}
              active={n === set.reps}
              onPress={() => {
                void Haptics.selectionAsync()
                writeReps(n)
              }}
            />
          ))}
        </Stepper>

        {done ? (
          <Button label="Done" onPress={onClose} />
        ) : (
          <View className="flex-row gap-3">
            <Button label="Close" variant="secondary" className="flex-1" onPress={onClose} />
            <Button label="Complete set" className="flex-1" onPress={onComplete} />
          </View>
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
})
