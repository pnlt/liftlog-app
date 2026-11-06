import { useAuth } from '@clerk/expo'
import { Stack } from 'expo-router'
import { useProfile } from '@/features/profile/store'
import colors from '@/ui/colors'

export default function SignedInLayout() {
  const { userId } = useAuth()
  const onboarded = useProfile((s) => s.profile != null)
  // Children call useUserId(); never render them during the sign-out transition.
  if (!userId) return null

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Protected guard={onboarded}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="workout" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="add-exercise" options={{ presentation: 'modal', title: 'Add exercise' }} />
        <Stack.Screen name="exercise/[id]" options={{ title: '' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Workout' }} />
      </Stack.Protected>
    </Stack>
  )
}
