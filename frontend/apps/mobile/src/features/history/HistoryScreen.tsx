import { useState } from 'react'
import { FlatList } from 'react-native'
import { useUserId } from '@/features/auth/use-user-id'
import { useSettings } from '@/features/settings/store'
import { useHistory } from '@/data/workout-queries'
import { EmptyState, Loading, Screen } from '@/ui'
import { SessionCard } from './SessionCard'

export function HistoryScreen() {
  const userId = useUserId()
  const unit = useSettings((s) => s.unit)
  const [limit, setLimit] = useState(50)
  const { data, updatedAt } = useHistory(userId, limit)

  if (!updatedAt) return <Loading />
  return (
    <Screen scroll={false} edges={[]}>
      <FlatList
        data={data}
        onEndReached={() => {
          if (data.length >= limit) setLimit((value) => value + 50)
        }}
        onEndReachedThreshold={0.5}
        keyExtractor={(s) => s.id}
        contentContainerClassName="gap-3 p-4 pb-12"
        ListEmptyComponent={<EmptyState title="No workouts yet" body="Finished workouts show up here." />}
        renderItem={({ item }) => <SessionCard item={item} unit={unit} />}
      />
    </Screen>
  )
}
