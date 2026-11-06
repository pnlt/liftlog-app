import type { Exercise } from '@liftlog/contracts'
import type { Muscle } from '@liftlog/domain'
import { asc, eq, sql } from 'drizzle-orm'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { db } from './db/client'
import { exercises, type ExerciseRow } from './db/schema'

export type { ExerciseRow }

export async function upsertExercises(items: Exercise[]): Promise<void> {
  if (items.length === 0) return
  db.transaction((tx) => {
    for (const e of items) {
      const row = { ...e, updatedAt: new Date(e.updatedAt) }
      tx.insert(exercises).values(row).onConflictDoUpdate({ target: exercises.id, set: row }).run()
    }
  })
}

export function useExercises(search: string, muscle: Muscle | null) {
  const term = search.trim().toLowerCase()
  return useLiveQuery(
    db
      .select()
      .from(exercises)
      .where(
        sql`(${term} = '' OR lower(${exercises.name}) LIKE '%' || ${term} || '%')
          AND (${muscle} IS NULL OR EXISTS (SELECT 1 FROM json_each(${exercises.primaryMuscles}) WHERE value = ${muscle}))`,
      )
      .orderBy(asc(exercises.name)),
    [term, muscle],
  )
}

export function useExercise(id: string) {
  return useLiveQuery(db.select().from(exercises).where(eq(exercises.id, id)).limit(1), [id])
}

export function useExerciseNames(): ReadonlyMap<string, ExerciseRow> {
  const { data } = useLiveQuery(db.select().from(exercises))
  return new Map(data.map((e) => [e.id, e]))
}
