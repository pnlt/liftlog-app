import * as Haptics from 'expo-haptics'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { formatDuration } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { Button, Text } from '@/ui'
import colors from '@/ui/colors'
import { AnimatedStyleView, sheetIn, sheetOut } from '@/ui/motion'
import { useRestTimer } from './rest-timer-store'

export function RestTimer() {
  const { endsAt, durationSec, adjust, stop } = useRestTimer()
  const now = useNow(250, endsAt != null)
  const remaining = endsAt == null ? 0 : Math.max(0, (endsAt - now) / 1000)
  const finished = endsAt != null && remaining === 0
  const progress = useSharedValue(1)
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }))

  useEffect(() => {
    if (!finished) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    stop()
  }, [finished, stop])

  useEffect(() => {
    if (endsAt == null || durationSec <= 0) return
    const left = Math.max(0, endsAt - Date.now())
    progress.set(Math.min(1, left / 1000 / durationSec))
    progress.set(withTiming(0, { duration: left, easing: Easing.linear }))
  }, [endsAt, durationSec, progress])

  if (endsAt == null) return null

  return (
    <Animated.View
      entering={sheetIn}
      exiting={sheetOut}
      className="gap-3 border-t border-border bg-surface-raised p-4"
    >
      <View className="h-1 overflow-hidden rounded-full bg-border">
        <AnimatedStyleView style={[styles.bar, barStyle]} />
      </View>
      <View className="flex-row items-center justify-between">
        <View>
          <Text variant="muted">Rest</Text>
          <Text
            variant="title"
            className="font-mono"
            accessibilityRole="timer"
            accessibilityLabel={`Rest ${formatDuration(remaining)} remaining`}
          >
            {formatDuration(Math.ceil(remaining))}
          </Text>
        </View>
        <View className="flex-row gap-2">
          <Button
            label="-15"
            size="sm"
            variant="secondary"
            accessibilityLabel="Subtract 15 seconds"
            onPress={() => adjust(-15)}
          />
          <Button
            label="+15"
            size="sm"
            variant="secondary"
            accessibilityLabel="Add 15 seconds"
            onPress={() => adjust(15)}
          />
          <Button label="Skip" size="sm" variant="ghost" onPress={stop} />
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bar: { height: '100%', width: '100%', backgroundColor: colors.primary.DEFAULT, transformOrigin: 'left' },
})
