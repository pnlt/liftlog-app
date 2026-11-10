import '../global.css'

import { ClerkProvider, useAuth } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { z } from 'zod'
import { DatabaseGate } from '@/data/DatabaseGate'
import { envResult } from '@/lib/env'
import { SyncProvider } from '@/services/sync/SyncProvider'
import { EmptyState, Screen } from '@/ui'
import colors from '@/ui/colors'

void SplashScreen.preventAutoHideAsync()

function RootNavigator() {
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (isLoaded) void SplashScreen.hideAsync()
  }, [isLoaded])

  if (!isLoaded) return null
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="sso-callback" />
    </Stack>
  )
}

function AccountRuntime() {
  const { userId, isLoaded } = useAuth()
  useEffect(() => {
    if (isLoaded) void SplashScreen.hideAsync()
  }, [isLoaded])
  return (
    <SyncProvider>
      <RootNavigator key={userId ?? 'signed-out'} />
    </SyncProvider>
  )
}

export default function RootLayout() {
  if (!envResult.success) {
    void SplashScreen.hideAsync()
    return (
      <Screen>
        <EmptyState title="App is misconfigured" body={z.prettifyError(envResult.error)} />
      </Screen>
    )
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider publishableKey={envResult.data.clerkPublishableKey} tokenCache={tokenCache}>
        <KeyboardProvider>
          <StatusBar style="light" />
          <DatabaseGate>
            <AccountRuntime />
          </DatabaseGate>
        </KeyboardProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
  )
}
