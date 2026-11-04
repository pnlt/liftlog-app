import { View } from 'react-native'
import { Text } from './Text'

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View className="items-center gap-1 py-12">
      <Text variant="heading">{title}</Text>
      {body && (
        <Text variant="muted" className="text-center">
          {body}
        </Text>
      )}
    </View>
  )
}
