import type { Muscle } from '@liftlog/domain'
import { Image, type ImageSource } from 'expo-image'
import { router } from 'expo-router'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { Text } from '@/ui'
import colors from '@/ui/colors'
import { AnimatedStyleView } from '@/ui/motion'

interface Feature {
  muscle: Muscle
  title: string
  body: string
  image: ImageSource
}

const FEATURES: Feature[] = [
  {
    muscle: 'chest',
    title: 'Push day',
    body: 'Bench, press, dips',
    image: require('../../../assets/images/photos/chest.jpg'),
  },
  {
    muscle: 'quads',
    title: 'Leg day',
    body: 'Squats, lunges, presses',
    image: require('../../../assets/images/photos/legs.jpg'),
  },
  {
    muscle: 'lats',
    title: 'Pull day',
    body: 'Rows, pull-ups, curls',
    image: require('../../../assets/images/photos/back.jpg'),
  },
  {
    muscle: 'abs',
    title: 'Core',
    body: 'Planks, rollouts, crunches',
    image: require('../../../assets/images/photos/core.jpg'),
  },
]

const GAP = 12
const PEEK = 28
const PARALLAX = 48

function Card({
  feature,
  index,
  x,
  width,
  snap,
}: {
  feature: Feature
  index: number
  x: SharedValue<number>
  width: number
  snap: number
}) {
  const range = [(index - 1) * snap, index * snap, (index + 1) * snap]
  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), range, [0.7, 1, 0.7], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(x.get(), range, [0.94, 1, 0.94], Extrapolation.CLAMP) }],
  }))
  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(x.get(), range, [-PARALLAX, 0, PARALLAX], Extrapolation.CLAMP) }],
  }))
  const textStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(x.get(), range, [PARALLAX, 0, -PARALLAX], Extrapolation.CLAMP) }],
  }))

  return (
    <AnimatedStyleView style={[{ width }, cardStyle]}>
      <Pressable
        onPress={() => router.push({ pathname: '/exercises', params: { muscle: feature.muscle } })}
        accessibilityRole="button"
        accessibilityLabel={`${feature.title}: ${feature.body}`}
        accessibilityHint="Shows matching exercises"
        className="h-52 overflow-hidden rounded-3xl bg-surface"
      >
        <AnimatedStyleView style={[styles.image, { width: width + PARALLAX * 2 }, imageStyle]}>
          <Image source={feature.image} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        </AnimatedStyleView>
        <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        <AnimatedStyleView style={[styles.caption, textStyle]}>
          <Text variant="heading">{feature.title}</Text>
          <Text variant="muted" className="text-foreground/80">
            {feature.body}
          </Text>
        </AnimatedStyleView>
      </Pressable>
    </AnimatedStyleView>
  )
}

function Dot({ index, x, snap }: { index: number; x: SharedValue<number>; snap: number }) {
  const style = useAnimatedStyle(() => {
    const range = [(index - 1) * snap, index * snap, (index + 1) * snap]
    return {
      opacity: interpolate(x.get(), range, [0.35, 1, 0.35], Extrapolation.CLAMP),
      transform: [{ scaleX: interpolate(x.get(), range, [1, 2.5, 1], Extrapolation.CLAMP) }],
    }
  })
  return <AnimatedStyleView style={[styles.dot, style]} />
}

export function FeaturedCarousel() {
  const { width: screen } = useWindowDimensions()
  const width = screen - 32 - PEEK
  const snap = width + GAP
  const x = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => x.set(e.contentOffset.x))

  return (
    <View className="-mx-4 gap-3">
      <Animated.ScrollView
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={snap}
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
      >
        {FEATURES.map((f, i) => (
          <Card key={f.muscle} feature={f} index={i} x={x} width={width} snap={snap} />
        ))}
      </Animated.ScrollView>
      <View className="flex-row justify-center gap-3" importantForAccessibility="no-hide-descendants">
        {FEATURES.map((f, i) => (
          <Dot key={f.muscle} index={i} x={x} snap={snap} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  track: { paddingHorizontal: 16, gap: GAP },
  image: { position: 'absolute', top: 0, bottom: 0, left: -PARALLAX },
  scrim: { backgroundImage: `linear-gradient(to bottom, transparent 35%, ${colors.background}e6 100%)` },
  caption: { position: 'absolute', left: 20, right: 20, bottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary.DEFAULT },
})
