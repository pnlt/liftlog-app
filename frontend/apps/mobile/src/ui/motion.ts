import { cssInterop } from 'nativewind'
import { View } from 'react-native'
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
  type WithSpringConfig,
} from 'react-native-reanimated'

// NativeWind v4 only styles core components; this lets Animated.View take className too.
cssInterop(Animated.View, { className: 'style' })

/** The interop above swallows useAnimatedStyle output; anything driven by an animated style uses this instead. */
export const AnimatedStyleView = Animated.createAnimatedComponent(View)

/** Presets default to ReduceMotion.System. Exits run faster so the UI never waits on a leaving element. */
export const duration = { fast: 140, base: 220, slow: 320 } as const

export const spring = {
  press: { damping: 20, stiffness: 420 },
  pop: { damping: 10, stiffness: 320 },
} satisfies Record<string, WithSpringConfig>

export const fadeIn = FadeIn.duration(duration.base)
export const fadeOut = FadeOut.duration(duration.fast)
export const listLayout = LinearTransition.springify().damping(26).stiffness(360)
export const sheetIn = SlideInDown.springify().damping(30).stiffness(380)
export const sheetOut = SlideOutDown.duration(duration.base)
export const popIn = ZoomIn.springify().damping(spring.pop.damping).stiffness(spring.pop.stiffness)
