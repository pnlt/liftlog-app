import { MUSCLES, type Muscle } from '@liftlog/domain'
import { useState } from 'react'
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useExercises, type ExerciseRow } from '@/data/exercises'
import { Chip, EmptyState, Text } from '@/ui'
import colors from '@/ui/colors'
import { ExerciseDemo } from './ExerciseDemo'
import { MUSCLE_LABELS } from './labels'

export function ExerciseList({
  onSelect,
  initialMuscle,
}: {
  onSelect: (exercise: ExerciseRow) => void
  initialMuscle?: Muscle
}) {
  const [search, setSearch] = useState('')
  const [muscle, setMuscle] = useState<Muscle | null>(
    initialMuscle && MUSCLES.includes(initialMuscle) ? initialMuscle : null,
  )
  const { data } = useExercises(search, muscle)

  return (
    <FlatList
      data={data}
      keyExtractor={(e) => e.id}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="pb-12"
      ListHeaderComponent={
        <View className="gap-3 p-4">
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search exercises"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search exercises"
            className="h-12 rounded-xl bg-surface px-4 text-base text-foreground"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            <Chip label="All" active={muscle == null} onPress={() => setMuscle(null)} />
            {MUSCLES.map((m) => (
              <Chip key={m} label={MUSCLE_LABELS[m]} active={muscle === m} onPress={() => setMuscle(m)} />
            ))}
          </ScrollView>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No exercises found" body="Try another search or muscle." />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onSelect(item)}
          accessibilityRole="button"
          className="mx-4 flex-row items-center gap-3 border-b border-border py-3 active:opacity-60"
        >
          <ExerciseDemo exercise={item} still style={{ width: 52, height: 52, borderRadius: 12 }} />
          <View className="flex-1">
            <Text variant="body">{item.name}</Text>
            <Text variant="muted">{item.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(', ')}</Text>
          </View>
        </Pressable>
      )}
    />
  )
}
