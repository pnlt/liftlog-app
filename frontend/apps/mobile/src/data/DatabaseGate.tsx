import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator'
import { useEffect, type ReactNode } from 'react'
import { syncExerciseCatalog } from '@/services/content/sync'
import { EmptyState } from '@/ui'
import { db } from './db/client'
import migrations from './db/migrations/migrations'

export function DatabaseGate({ children }: { children: ReactNode }) {
  const { success, error } = useMigrations(db, migrations)

  useEffect(() => {
    if (success) syncExerciseCatalog().catch((err: unknown) => console.error('[content] sync failed', err))
  }, [success])

  if (error) {
    console.error('[db] migration failed', error)
    return (
      <EmptyState
        title="Could not open your data"
        body="Restart the app. If this keeps happening, contact support."
      />
    )
  }
  return success ? children : null
}
