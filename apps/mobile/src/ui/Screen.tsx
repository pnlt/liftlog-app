import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  edges?: Edge[]
}

export function Screen({ children, scroll = true, edges = ['top'] }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-background">
      {scroll ? (
        <ScrollView contentContainerClassName="gap-4 p-4 pb-12" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}
    </SafeAreaView>
  )
}
