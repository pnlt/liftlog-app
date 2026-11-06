import { View, type ViewProps } from 'react-native'

export function Card({ className = '', ...props }: ViewProps) {
  return <View className={`rounded-2xl border border-border bg-surface p-4 ${className}`} {...props} />
}
