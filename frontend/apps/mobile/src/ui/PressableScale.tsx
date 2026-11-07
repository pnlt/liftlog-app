import { Pressable, View, type PressableProps } from 'react-native'
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { AnimatedStyleView, spring } from './motion'

interface PressableScaleProps extends PressableProps {
  className?: string
  containerClassName?: string
  pressedScale?: number
}

export function PressableScale({
  containerClassName,
  pressedScale = 0.96,
  onPressIn,
  onPressOut,
  ...props
}: PressableScaleProps) {
  const scale = useSharedValue(1)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }))

  return (
    <View className={containerClassName}>
      <AnimatedStyleView style={style}>
        <Pressable
          onPressIn={(e) => {
            scale.set(withSpring(pressedScale, spring.press))
            onPressIn?.(e)
          }}
          onPressOut={(e) => {
            scale.set(withSpring(1, spring.press))
            onPressOut?.(e)
          }}
          {...props}
        />
      </AnimatedStyleView>
    </View>
  )
}
