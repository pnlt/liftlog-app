import { useClerk, useUser } from '@clerk/expo'
import { UNITS } from '@myos/domain'
import Constants from 'expo-constants'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSettings } from '@/features/settings/store'
import { SyncStatus } from '@/features/sync/SyncStatus'
import { PlanSummary } from './PlanSummary'
import { usePlan, useProfile } from './store'
import { formatDuration } from '@/lib/format'
import { confirmAction } from '@/lib/dialogs'
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
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function confirmRedo() {
    if (
      await confirmAction('Update your plan?', 'Answer the questions again. Your workouts are kept.', {
        confirmLabel: 'Start',
      })
    )
      clearProfile()
  }

  async function signOutAccount() {
    setSignOutError(null)
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      setSignOutError('Could not sign out. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }

  async function confirmSignOut() {
    if (signingOut) return
    const message = 'Unsent changes stay on this device until you sign in to this account again.'
    if (await confirmAction('Sign out?', message, { confirmLabel: 'Sign out', destructive: true }))
      await signOutAccount()
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

      {signOutError && <Text accessibilityRole="alert">{signOutError}</Text>}
      <Button label="Sign out" variant="danger" loading={signingOut} onPress={confirmSignOut} />
      <SyncStatus />
      <Text variant="muted" className="text-center">
        Version {Constants.expoConfig?.version}
      </Text>
    </Screen>
  )
}
