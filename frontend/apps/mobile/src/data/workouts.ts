import type { WorkoutCompletedEvent } from '@liftlog/contracts'
import { bestE1rm, sessionStats, type LoggedSet } from '@liftlog/domain'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'expo-crypto'
import { db, type Db } from './db/client'
import { workoutExercises, workoutSessions, workoutSets, type WorkoutSetRow } from './db/schema'

/** Every child write bumps `workout_sessions.updated_at` in the same transaction: sync and live queries rely on it.
 Transaction callbacks stay sync (.run()/.get()/.all()); after an await, statements run outside the transaction. */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const touch = (tx: Tx, sessionId: string) =>
  tx.update(workoutSessions).set({ updatedAt: new Date() }).where(eq(workoutSessions.id, sessionId)).run()

export const activeWhere = (userId: string) =>
  and(eq(workoutSessions.userId, userId), isNull(workoutSessions.endedAt), isNull(workoutSessions.deletedAt))

export const finishedWhere = (userId: string) =>
  and(
    eq(workoutSessions.userId, userId),
    isNotNull(workoutSessions.endedAt),
    isNull(workoutSessions.deletedAt),
  )

export const toLogged = (s: Pick<WorkoutSetRow, 'kg' | 'reps'>): LoggedSet => ({
  kg: s.kg,
  reps: s.reps ?? 0,
})

/** Returns the open session if there is one, so a double tap never starts two workouts. */
export async function startSession(userId: string): Promise<string> {
  return db.transaction((tx) => {
    const open = tx.select({ id: workoutSessions.id }).from(workoutSessions).where(activeWhere(userId)).get()
    if (open) return open.id
    const now = new Date()
    const id = randomUUID()
    tx.insert(workoutSessions).values({ id, userId, startedAt: now, updatedAt: now }).run()
    return id
  })
}

export async function lastPerformance(userId: string, exerciseId: string): Promise<WorkoutSetRow[]> {
  const [last] = await db
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutExercises.sessionId))
    .where(and(finishedWhere(userId), eq(workoutExercises.exerciseId, exerciseId)))
    .orderBy(desc(workoutSessions.startedAt))
    .limit(1)
  if (!last) return []
  return db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutExerciseId, last.id), isNotNull(workoutSets.completedAt)))
    .orderBy(asc(workoutSets.position))
}

export async function addExercise(userId: string, sessionId: string, exerciseId: string): Promise<void> {
  const previous = await lastPerformance(userId, exerciseId)
  db.transaction((tx) => {
    const last = tx
      .select({ max: sql<number | null>`max(${workoutExercises.position})` })
      .from(workoutExercises)
      .where(eq(workoutExercises.sessionId, sessionId))
      .get()
    const workoutExerciseId = randomUUID()
    tx.insert(workoutExercises)
      .values({ id: workoutExerciseId, sessionId, exerciseId, position: (last?.max ?? -1) + 1 })
      .run()
    const template = previous.length > 0 ? previous : [{ kg: null, reps: null, isWarmup: false }]
    tx.insert(workoutSets)
      .values(
        template.map((s, position) => ({
          id: randomUUID(),
          workoutExerciseId,
          position,
          kg: s.kg,
          reps: s.reps,
          isWarmup: s.isWarmup,
        })),
      )
      .run()
    touch(tx, sessionId)
  })
}

export async function removeExercise(sessionId: string, workoutExerciseId: string): Promise<void> {
  db.transaction((tx) => {
    tx.delete(workoutExercises).where(eq(workoutExercises.id, workoutExerciseId)).run()
    touch(tx, sessionId)
  })
}

export async function addSet(sessionId: string, workoutExerciseId: string): Promise<void> {
  db.transaction((tx) => {
    const prev = tx
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.workoutExerciseId, workoutExerciseId))
      .orderBy(desc(workoutSets.position))
      .get()
    tx.insert(workoutSets)
      .values({
        id: randomUUID(),
        workoutExerciseId,
        position: prev ? prev.position + 1 : 0,
        kg: prev?.kg ?? null,
        reps: prev?.reps ?? null,
      })
      .run()
    touch(tx, sessionId)
  })
}

export type SetPatch = Partial<Pick<WorkoutSetRow, 'kg' | 'reps' | 'isWarmup'>> & { completed?: boolean }

export async function updateSet(sessionId: string, setId: string, patch: SetPatch): Promise<void> {
  const { completed, ...fields } = patch
  db.transaction((tx) => {
    tx.update(workoutSets)
      .set({ ...fields, ...(completed === undefined ? {} : { completedAt: completed ? new Date() : null }) })
      .where(eq(workoutSets.id, setId))
      .run()
    touch(tx, sessionId)
  })
}

export async function removeSet(sessionId: string, setId: string): Promise<void> {
  db.transaction((tx) => {
    tx.delete(workoutSets).where(eq(workoutSets.id, setId)).run()
    touch(tx, sessionId)
  })
}

export async function updateSessionNote(sessionId: string, note: string): Promise<void> {
  await db
    .update(workoutSessions)
    .set({ note: note.trim() || null, updatedAt: new Date() })
    .where(eq(workoutSessions.id, sessionId))
}

async function previousBests(userId: string, sessionId: string, exerciseIds: string[]) {
  const rows = await db
    .select({ exerciseId: workoutExercises.exerciseId, kg: workoutSets.kg, reps: workoutSets.reps })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, workoutSets.workoutExerciseId))
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutExercises.sessionId))
    .where(
      and(
        finishedWhere(userId),
        ne(workoutSessions.id, sessionId),
        inArray(workoutExercises.exerciseId, exerciseIds),
        isNotNull(workoutSets.completedAt),
        eq(workoutSets.isWarmup, false),
      ),
    )
  const grouped = new Map<string, LoggedSet[]>()
  for (const r of rows) grouped.set(r.exerciseId, [...(grouped.get(r.exerciseId) ?? []), toLogged(r)])
  const bests = new Map<string, number>()
  for (const [id, sets] of grouped) {
    const best = bestE1rm(sets)
    if (best != null) bests.set(id, best)
  }
  return bests
}

export class EmptyWorkoutError extends Error {
  constructor() {
    super('Complete at least one set before finishing')
  }
}

export async function finishSession(userId: string, sessionId: string): Promise<WorkoutCompletedEvent> {
  const session = await db.query.workoutSessions.findFirst({
    where: and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)),
    with: { exercises: { with: { sets: true } } },
  })
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const done = session.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.completedAt != null) }))
    .filter((e) => e.sets.length > 0)
  if (done.length === 0) throw new EmptyWorkoutError()

  const working = done.map((e) => ({
    exerciseId: e.exerciseId,
    sets: e.sets.filter((s) => !s.isWarmup).map(toLogged),
  }))
  const stats = sessionStats(
    working,
    await previousBests(
      userId,
      sessionId,
      done.map((e) => e.exerciseId),
    ),
  )
  const endedAt = new Date()

  db.transaction((tx) => {
    for (const e of session.exercises) {
      if (!done.some((d) => d.id === e.id)) {
        tx.delete(workoutExercises).where(eq(workoutExercises.id, e.id)).run()
      } else {
        tx.delete(workoutSets)
          .where(and(eq(workoutSets.workoutExerciseId, e.id), isNull(workoutSets.completedAt)))
          .run()
      }
    }
    tx.update(workoutSessions)
      .set({ endedAt, updatedAt: endedAt })
      .where(eq(workoutSessions.id, sessionId))
      .run()
  })

  return {
    type: 'workout.completed',
    sessionId,
    userId,
    startedAt: session.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSec: Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000),
    ...stats,
  }
}

/** Hard delete: an unfinished session has never been synced. */
export async function discardSession(sessionId: string): Promise<void> {
  await db
    .delete(workoutSessions)
    .where(and(eq(workoutSessions.id, sessionId), isNull(workoutSessions.endedAt)))
}

export async function deleteSession(sessionId: string): Promise<void> {
  const now = new Date()
  await db
    .update(workoutSessions)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(workoutSessions.id, sessionId))
}
