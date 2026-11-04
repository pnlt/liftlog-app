import { useClerk, useUser } from '@clerk/expo'
import { UNITS } from '@liftlog/domain'
import Constants from 'expo-constants'
import { Image } from 'expo-image'
import { Alert, Pressable, View } from 'react-native'
import { useSettings } from '@/features/settings/store'
import { PlanSummary } from './PlanSummary'
import { usePlan, useProfile } from './store'
import { formatDuration } from '@/lib/format'
import { Button, Card, Screen, Text } from '@/ui'

const DEMO_STYLES = [
  { value: 'art', label: 'Line art' },
  { value: 'photo', label: 'Photos' },
] as const

export function ProfileScreen() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { unit, setUnit, restSeconds, setRestSeconds, demoStyle, setDemoStyle } = useSettings()
  const { profile, clearProfile } = useProfile()
  const plan = usePlan()

  function confirmRedo() {
    Alert.alert('Update your plan?', 'Answer the questions again. Your workouts are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start', onPress: clearProfile },
    ])
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Workouts stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <Screen>
      <Card className="flex-row items-center gap-4">
        {user?.imageUrl && (
          <Image
            source={user.imageUrl}
            style={{ width: 56, height: 56, borderRadius: 28 }}
            accessibilityIgnoresInvertColors
          />
        )}
        <View className="flex-1">
          <Text variant="heading">{user?.fullName ?? 'Athlete'}</Text>
          <Text variant="muted">{user?.primaryEmailAddress?.emailAddress}</Text>
        </View>
      </Card>

      {profile && plan && (
        <PlanSummary
          plan={plan}
          unit={unit}
          daysPerWeek={profile.daysPerWeek}
          sessionMinutes={profile.sessionMinutes}
        />
      )}
      <Button label="Update my plan" variant="secondary" onPress={confirmRedo} />

      <Card className="gap-3">
        <Text variant="heading">Weight unit</Text>
        <View className="flex-row gap-2" accessibilityRole="radiogroup">
          {UNITS.map((u) => (
            <Pressable
              key={u}
              onPress={() => setUnit(u)}
              accessibilityRole="radio"
              accessibilityState={{ checked: unit === u }}
              className={`min-h-11 flex-1 items-center justify-center rounded-lg ${unit === u ? 'bg-primary' : 'bg-surface-raised'}`}
            >
              <Text variant="label" className={unit === u ? 'text-primary-foreground' : ''}>
                {u}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card className="gap-3">
        <Text variant="heading">Exercise demos</Text>
        <View className="flex-row gap-2" accessibilityRole="radiogroup">
          {DEMO_STYLES.map(({ value, label }) => (
            <Pressable
              key={value}
              onPress={() => setDemoStyle(value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: demoStyle === value }}
              className={`min-h-11 flex-1 items-center justify-center rounded-lg ${demoStyle === value ? 'bg-primary' : 'bg-surface-raised'}`}
            >
              <Text variant="label" className={demoStyle === value ? 'text-primary-foreground' : ''}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text variant="muted">Filmed clips play instead where available.</Text>
      </Card>

      <Card className="gap-3">
        <Text variant="heading">Default rest</Text>
        <View className="flex-row items-center justify-between">
          <Button
            label="-15s"
            size="sm"
            variant="secondary"
            onPress={() => setRestSeconds(restSeconds - 15)}
          />
          <Text variant="title" className="font-mono" accessibilityLiveRegion="polite">
            {formatDuration(restSeconds)}
          </Text>
          <Button
            label="+15s"
            size="sm"
            variant="secondary"
            onPress={() => setRestSeconds(restSeconds + 15)}
          />
        </View>
      </Card>

      <Button label="Sign out" variant="danger" onPress={confirmSignOut} />
      <Text variant="muted" className="text-center">
        Version {Constants.expoConfig?.version}
      </Text>
    </Screen>
  )
}
