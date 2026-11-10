import { useUser } from '@clerk/expo'
import Ionicons from '@expo/vector-icons/Ionicons'
import { UserProfileSchema } from '@myos/contracts'
import {
  ACTIVITIES,
  bmi,
  buildPlan,
  choosePhase,
  EXPERIENCES,
  fromDisplay,
  GOALS,
  PACES,
  PLACES,
  SEXES,
  toDisplay,
  type Activity,
  type Experience,
  type Goal,
  type Pace,
  type Place,
  type Sex,
} from '@myos/domain'
import * as Haptics from 'expo-haptics'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, BackHandler, Platform, ScrollView, TextInput, View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, {
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'
import { PlanSummary } from '@/features/profile/PlanSummary'
import {
  ACTIVITY_CHOICES,
  EXPERIENCE_CHOICES,
  GOAL_CHOICES,
  PACE_CHOICES,
  PLACE_CHOICES,
  SEX_CHOICES,
} from '@/features/profile/labels'
import { useProfile } from '@/features/profile/store'
import { useSettings } from '@/features/settings/store'
import { Button, Chip, Screen, Text } from '@/ui'
import colors from '@/ui/colors'
import { AnimatedStyleView, duration, spring } from '@/ui/motion'
import { NumberStepper, Option } from './fields'

interface Draft {
  name: string
  age: number
  heightCm: number
  weightKg: number
  daysPerWeek: number
  sessionMinutes: number
  pace: Pace
  sex?: Sex
  goal?: Goal
  experience?: Experience
  place?: Place
  activity?: Activity
}

type StepId =
  | 'name'
  | 'sex'
  | 'age'
  | 'body'
  | 'goal'
  | 'experience'
  | 'schedule'
  | 'place'
  | 'activity'
  | 'pace'
  | 'building'
  | 'plan'

const COPY: Record<StepId, { title: string; body: string }> = {
  name: { title: 'What should we call you?', body: 'Your coach uses it, nobody else sees it.' },
  sex: { title: 'Your sex', body: 'Men and women burn energy at different rates.' },
  age: { title: 'How old are you?', body: 'Metabolism slows a little every decade.' },
  body: { title: 'Height and weight', body: 'The base for your calories and protein.' },
  goal: { title: 'What is your main goal?', body: 'Pick the one that matters most right now.' },
  experience: { title: 'How long have you trained?', body: 'Sets the volume you can recover from.' },
  schedule: { title: 'Your training week', body: 'Be honest: consistency beats ambition.' },
  place: { title: 'Where do you train?', body: 'Your exercises match your equipment.' },
  activity: { title: 'Outside the gym you are…', body: 'Daily movement is most of what you burn.' },
  pace: { title: 'How fast do you want to lose?', body: 'Slower keeps more muscle and is easier to keep.' },
  building: { title: 'Building your plan', body: '' },
  plan: { title: 'Your plan', body: '' },
}

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const MINUTES = [30, 45, 60, 75, 90]
const CM_PER_IN = 2.54
const BUILD_STEPS = [
  'Estimating your energy needs',
  'Choosing your phase',
  'Setting your macros',
  'Picking your split',
]
const BUILD_MS = 1600

function Progress({ value }: { value: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: withSpring(value, spring.press) }] }))
  return (
    <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
      <AnimatedStyleView
        style={[{ height: '100%', backgroundColor: colors.primary.DEFAULT, transformOrigin: 'left' }, style]}
      />
    </View>
  )
}

function Building() {
  return (
    <View className="flex-1 justify-center gap-5">
      <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      {BUILD_STEPS.map((label, i) => (
        <Animated.View
          key={label}
          entering={FadeInDown.delay(i * (BUILD_MS / BUILD_STEPS.length)).duration(duration.base)}
          className="flex-row items-center justify-center gap-2"
        >
          <Ionicons name="checkmark-circle" size={20} color={colors.primary.DEFAULT} />
          <Text variant="body">{label}</Text>
        </Animated.View>
      ))}
    </View>
  )
}

export function OnboardingScreen() {
  const { user } = useUser()
  const { unit, setUnit, setRestSeconds } = useSettings()
  const setProfile = useProfile((s) => s.setProfile)
  const editing = useProfile((s) => s.editing)
  const cancelEditing = useProfile((s) => s.cancelEditing)
  const [draft, setDraft] = useState<Draft>(() => ({
    name: user?.firstName ?? '',
    age: 25,
    heightCm: 175,
    weightKg: 75,
    daysPerWeek: 3,
    sessionMinutes: 60,
    pace: 'standard',
  }))
  const [step, setStep] = useState(0)
  const [forward, setForward] = useState(true)
  const keyboard = useReanimatedKeyboardAnimation()
  // keyboard-controller's KeyboardAvoidingView is an Animated.View, whose style the NativeWind interop drops.
  const avoidKeyboard = useAnimatedStyle(() => ({ paddingBottom: Math.max(24, -keyboard.height.value) }))

  const cutting =
    draft.goal != null &&
    draft.experience != null &&
    choosePhase(draft.goal, bmi(draft), draft.experience) === 'cut'
  const steps: StepId[] = [
    'name',
    'sex',
    'age',
    'body',
    'goal',
    'experience',
    'schedule',
    'place',
    'activity',
    ...(cutting ? (['pace'] as const) : []),
    'building',
    'plan',
  ]
  const id = steps[step] ?? 'plan'

  const profile = useMemo(() => {
    const parsed = UserProfileSchema.safeParse({ ...draft, updatedAt: new Date().toISOString() })
    return parsed.success ? parsed.data : null
  }, [draft])
  const plan = useMemo(() => (profile ? buildPlan(profile) : null), [profile])

  const go = (next: number) => {
    setForward(next > step)
    setStep(next)
  }
  // The build animation is not a place to land on when going back.
  const back = () => go(steps[step - 1] === 'building' ? step - 2 : step - 1)

  useEffect(() => {
    if (Platform.OS !== 'android' || step === 0 || id === 'building') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back()
      return true
    })
    return () => sub.remove()
  })

  useEffect(() => {
    if (id !== 'building') return
    const timer = setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStep((s) => s + 1)
    }, BUILD_MS + 400)
    return () => clearTimeout(timer)
  }, [id])

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const choose = (patch: Partial<Draft>) => {
    set(patch)
    const from = step
    setForward(true)
    setTimeout(() => setStep((s) => (s === from ? s + 1 : s)), 260)
  }

  const valid: Record<StepId, boolean> = {
    name: draft.name.trim().length > 0,
    sex: draft.sex != null,
    age: draft.age >= 13 && draft.age <= 100,
    body: draft.heightCm >= 120 && draft.heightCm <= 230 && draft.weightKg >= 30 && draft.weightKg <= 300,
    goal: draft.goal != null,
    experience: draft.experience != null,
    schedule: true,
    place: draft.place != null,
    activity: draft.activity != null,
    pace: true,
    building: false,
    plan: profile != null,
  }

  const finish = () => {
    if (!profile || !plan) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setRestSeconds(plan.restSeconds)
    setProfile(profile)
  }

  const entering = (forward ? FadeInRight : FadeInLeft).duration(duration.base)
  const exiting = (forward ? FadeOutLeft : FadeOutRight).duration(duration.fast)
  const copy = COPY[id]
  const imperial = unit === 'lb'

  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <AnimatedStyleView style={[{ flex: 1, gap: 24, padding: 24 }, avoidKeyboard]}>
        <View className="h-10 flex-row items-center gap-3">
          <Progress value={(step + 1) / steps.length} />
          {step > 0 && id !== 'building' && <Button label="Back" size="sm" variant="ghost" onPress={back} />}
          {editing && <Button label="Cancel" size="sm" variant="ghost" onPress={cancelEditing} />}
        </View>

        <Animated.View key={id} entering={entering} exiting={exiting} className="flex-1 gap-6">
          {id !== 'building' && (
            <View className="gap-2">
              <Text variant="title">
                {id === 'plan' && profile ? `${profile.name}, here is your plan` : copy.title}
              </Text>
              {copy.body !== '' && <Text variant="muted">{copy.body}</Text>}
            </View>
          )}

          {id === 'name' && (
            <TextInput
              value={draft.name}
              onChangeText={(name) => set({ name })}
              placeholder="Your first name"
              placeholderTextColor={colors.muted}
              maxLength={40}
              autoCapitalize="words"
              autoComplete="given-name"
              returnKeyType="next"
              onSubmitEditing={() => valid.name && go(step + 1)}
              accessibilityLabel="First name"
              className="h-16 rounded-2xl bg-surface-raised px-5 text-2xl font-semibold text-foreground"
            />
          )}

          {id === 'sex' && (
            <View className="gap-3">
              {SEXES.map((v) => (
                <Option
                  key={v}
                  {...SEX_CHOICES[v]}
                  selected={draft.sex === v}
                  onPress={() => choose({ sex: v })}
                />
              ))}
            </View>
          )}

          {id === 'age' && (
            <NumberStepper
              label="Age"
              unit="years"
              value={draft.age}
              step={1}
              min={13}
              max={100}
              onChange={(age) => set({ age })}
            />
          )}

          {id === 'body' && (
            <View className="gap-6">
              <View className="flex-row gap-2">
                <Chip label="Metric" active={!imperial} onPress={() => setUnit('kg')} />
                <Chip label="Imperial" active={imperial} onPress={() => setUnit('lb')} />
              </View>
              <NumberStepper
                label="Height"
                unit={imperial ? 'in' : 'cm'}
                value={imperial ? Math.round(draft.heightCm / CM_PER_IN) : Math.round(draft.heightCm)}
                step={1}
                min={imperial ? 48 : 120}
                max={imperial ? 90 : 230}
                onChange={(v) => set({ heightCm: imperial ? v * CM_PER_IN : v })}
              />
              <NumberStepper
                label="Weight"
                unit={unit}
                value={toDisplay(draft.weightKg, unit)}
                step={imperial ? 1 : 0.5}
                min={imperial ? 66 : 30}
                max={imperial ? 660 : 300}
                decimal
                onChange={(v) => set({ weightKg: fromDisplay(v, unit) })}
              />
            </View>
          )}

          {id === 'goal' && (
            <View className="gap-3">
              {GOALS.map((v) => (
                <Option
                  key={v}
                  {...GOAL_CHOICES[v]}
                  selected={draft.goal === v}
                  onPress={() => choose({ goal: v })}
                />
              ))}
            </View>
          )}

          {id === 'experience' && (
            <View className="gap-3">
              {EXPERIENCES.map((v) => (
                <Option
                  key={v}
                  {...EXPERIENCE_CHOICES[v]}
                  selected={draft.experience === v}
                  onPress={() => choose({ experience: v })}
                />
              ))}
            </View>
          )}

          {id === 'schedule' && (
            <View className="gap-6">
              <View className="gap-3">
                <Text variant="label" className="text-muted">
                  Days per week
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <Chip
                      key={d}
                      label={String(d)}
                      accessibilityLabel={`${d} days per week`}
                      active={draft.daysPerWeek === d}
                      onPress={() => set({ daysPerWeek: d })}
                    />
                  ))}
                </View>
              </View>
              <View className="gap-3">
                <Text variant="label" className="text-muted">
                  Minutes per session
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {MINUTES.map((m) => (
                    <Chip
                      key={m}
                      label={`${m}`}
                      accessibilityLabel={`${m} minutes per session`}
                      active={draft.sessionMinutes === m}
                      onPress={() => set({ sessionMinutes: m })}
                    />
                  ))}
                </View>
              </View>
            </View>
          )}

          {id === 'place' && (
            <View className="gap-3">
              {PLACES.map((v) => (
                <Option
                  key={v}
                  {...PLACE_CHOICES[v]}
                  selected={draft.place === v}
                  onPress={() => choose({ place: v })}
                />
              ))}
            </View>
          )}

          {id === 'activity' && (
            <View className="gap-3">
              {ACTIVITIES.map((v) => (
                <Option
                  key={v}
                  {...ACTIVITY_CHOICES[v]}
                  selected={draft.activity === v}
                  onPress={() => choose({ activity: v })}
                />
              ))}
            </View>
          )}

          {id === 'pace' && (
            <View className="gap-3">
              {PACES.map((v) => {
                const kg = profile ? -buildPlan({ ...profile, pace: v }).weeklyChangeKg : 0
                return (
                  <Option
                    key={v}
                    {...PACE_CHOICES[v]}
                    body={`${PACE_CHOICES[v].body} · about ${toDisplay(kg, unit)} ${unit} a week`}
                    selected={draft.pace === v}
                    onPress={() => set({ pace: v })}
                  />
                )
              })}
            </View>
          )}

          {id === 'building' && <Building />}

          {id === 'plan' && plan && (
            <ScrollView
              className="-mx-6"
              contentContainerClassName="px-6 pb-4"
              showsVerticalScrollIndicator={false}
            >
              <PlanSummary
                plan={plan}
                unit={unit}
                daysPerWeek={draft.daysPerWeek}
                sessionMinutes={draft.sessionMinutes}
              />
            </ScrollView>
          )}
        </Animated.View>

        {id !== 'building' && (
          <Button
            label={
              id === 'plan' ? 'Start my plan' : id === 'activity' && !cutting ? 'Build my plan' : 'Continue'
            }
            disabled={!valid[id]}
            onPress={() => (id === 'plan' ? finish() : go(step + 1))}
          />
        )}
      </AnimatedStyleView>
    </Screen>
  )
}
