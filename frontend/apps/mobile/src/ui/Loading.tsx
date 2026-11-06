import { ActivityIndicator, View } from 'react-native'
import colors from './colors'

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-background" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
    </View>
  )
}
