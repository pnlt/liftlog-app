import { useSSO } from '@clerk/expo'
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, Text } from '@/ui'
import colors from '@/ui/colors'
import { AnimatedStyleView, duration } from '@/ui/motion'

const reveal = (order: number) => FadeInDown.delay(120 + order * 90).duration(duration.slow)

WebBrowser.maybeCompleteAuthSession()

type Provider = { strategy: 'oauth_google' | 'oauth_apple'; label: string }

// App Store guideline 4.8: offering Google sign-in on iOS requires Sign in with Apple too.
const PROVIDERS: Provider[] = [
  { strategy: 'oauth_google', label: 'Continue with Google' },
  ...(Platform.OS === 'ios' ? [{ strategy: 'oauth_apple', label: 'Continue with Apple' } as const] : []),
]

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return
    void WebBrowser.warmUpAsync()
    return () => void WebBrowser.coolDownAsync()
  }, [])
}

function Hero() {
  const scale = useSharedValue(1.12)
  useEffect(() => {
    scale.set(withTiming(1, { duration: 2400, easing: Easing.out(Easing.cubic) }))
  }, [scale])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }))
  return (
    <AnimatedStyleView style={[StyleSheet.absoluteFill, style]}>
      <Image
        source={require('../../../assets/images/photos/welcome.jpg')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessible={false}
      />
    </AnimatedStyleView>
  )
}

export function SignInScreen() {
  useWarmUpBrowser()
  const { startSSOFlow } = useSSO()
  const [pending, setPending] = useState<Provider['strategy'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function signIn(strategy: Provider['strategy']) {
    setPending(strategy)
    setError(null)
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri({ path: 'sso-callback' }),
      })
      // The root navigator switches to the app once the session is active.
      if (createdSessionId && setActive) await setActive({ session: createdSessionId })
    } catch (err) {
      console.error('[auth] sign-in failed', err)
      setError('Sign-in failed. Check your connection and try again.')
    } finally {
      setPending(null)
    }
  }

  return (
    <View className="flex-1 bg-background">
      <Hero />
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <SafeAreaView edges={['bottom']} className="flex-1 justify-end gap-8 p-6">
        <View className="gap-3">
          <Animated.View entering={reveal(0)}>
            <Text variant="label" className="uppercase tracking-widest text-primary">
              LiftLog
            </Text>
          </Animated.View>
          <Animated.View entering={reveal(1)}>
            <Text variant="display">
              Train hard.{'\n'}Log it{' '}
              <Text variant="display" className="text-primary">
                fast.
              </Text>
            </Text>
          </Animated.View>
          <Animated.View entering={reveal(2)}>
            <Text variant="body" className="text-muted">
              Every set in two taps. Every gain on record. Works offline.
            </Text>
          </Animated.View>
        </View>
        <Animated.View entering={reveal(3)} className="gap-3">
          {PROVIDERS.map((p) => (
            <Button
              key={p.strategy}
              label={p.label}
              loading={pending === p.strategy}
              disabled={pending != null}
              onPress={() => signIn(p.strategy)}
            />
          ))}
          {error && (
            <Text variant="muted" className="text-danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
        </Animated.View>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  scrim: {
    backgroundImage: `linear-gradient(to bottom, transparent 30%, ${colors.background}d9 55%, ${colors.background} 72%)`,
  },
})
