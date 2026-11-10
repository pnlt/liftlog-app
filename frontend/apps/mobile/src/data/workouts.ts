import type { SyncWorkout, WorkoutCompletedEvent } from '@myos/contracts'
import { bestE1rm, sessionStats, type LoggedSet } from '@myos/domain'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { randomUUID } from 'expo-crypto'
import { workoutSessions, type WorkoutSetRow } from './db/schema'
import { localSqlite, syncRepository } from './sync'

export const activeWhere = (userId: string) =>
  and(eq(workoutSessions.userId, userId), isNull(workoutSessions.endedAt), isNull(workoutSessions.deletedAt))
export const finishedWhere = (userId: string) =>
  and(
    eq(workoutSessions.userId, userId),
    isNotNull(workoutSessions.endedAt),
    isNull(workoutSessions.deletedAt),
  )
export const toLogged = (set: Pick<WorkoutSetRow, 'kg' | 'reps'>): LoggedSet => ({
  kg: set.kg,
  reps: set.reps ?? 0,
})

function edit(owner: string, id: string, change: (workout: SyncWorkout) => void) {
  syncRepository.editWorkout(owner, id, (workout) => {
    change(workout)
    return { ...workout, updatedAt: new Date().toISOString() }
  })
}
function exerciseOf(workout: SyncWorkout, id: string) {
  const exercise = workout.exercises.find((item) => item.id === id)
  if (!exercise) throw new Error('Exercise not found in this workout')
  return exercise
}
function setOf(workout: SyncWorkout, id: string) {
  const set = workout.exercises.flatMap((exercise) => exercise.sets).find((item) => item.id === id)
  if (!set) throw new Error('Set not found in this workout')
  return set
}

/** A double tap resumes an existing local session; distinct remote open sessions stay available. */
export async function startSession(userId: string): Promise<string> {
  const open = localSqlite.get<{ id: string }>(
    'SELECT id FROM workout_sessions WHERE user_id=? AND ended_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [userId],
  )
  if (open) return open.id
  const now = new Date().toISOString(),
    id = randomUUID()
  syncRepository.saveWorkout(userId, {
    id,
    userId,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    deletedAt: null,
    note: null,
    exercises: [],
  })
  return id
}

export async function lastPerformance(userId: string, exerciseId: string): Promise<WorkoutSetRow[]> {
  const previous = localSqlite.get<{ id: string }>(
    `SELECT e.id FROM workout_exercises e JOIN workout_sessions w ON w.id=e.session_id
    WHERE w.user_id=? AND w.ended_at IS NOT NULL AND w.deleted_at IS NULL AND e.exercise_id=? ORDER BY w.started_at DESC LIMIT 1`,
    [userId, exerciseId],
  )
  if (!previous) return []
  return localSqlite
    .all<{
      id: string
      workout_exercise_id: string
      position: number
      kg: number | null
      reps: number | null
      is_warmup: number
      completed_at: number
    }>(
      'SELECT * FROM workout_sets WHERE workout_exercise_id=? AND completed_at IS NOT NULL ORDER BY position',
      [previous.id],
    )
    .map((set) => ({
      id: set.id,
      workoutExerciseId: set.workout_exercise_id,
      position: set.position,
      kg: set.kg,
      reps: set.reps,
      isWarmup: set.is_warmup !== 0,
      completedAt: new Date(set.completed_at),
    }))
}

export async function addExercise(userId: string, sessionId: string, exerciseId: string): Promise<void> {
  const previous = await lastPerformance(userId, exerciseId)
  const catalog = localSqlite.get<{ name: string; load: 'weight' | 'bodyweight' | 'time' }>(
    'SELECT name,load FROM exercises WHERE id=?',
    [exerciseId],
  )
  if (!catalog) throw new Error('Choose an exercise from the catalog')
  edit(userId, sessionId, (workout) => {
    const template = previous.length ? previous : [{ kg: null, reps: null, isWarmup: false }]
    workout.exercises.push({
      id: randomUUID(),
      exerciseId,
      exerciseSnapshot: catalog,
      position: Math.max(-1, ...workout.exercises.map((item) => item.position)) + 1,
      note: null,
      sets: template.map((set, position) => ({
        id: randomUUID(),
        position,
        kg: set.kg,
        reps: set.reps,
        isWarmup: set.isWarmup,
        completedAt: null,
      })),
    })
  })
}
export async function removeExercise(
  userId: string,
  sessionId: string,
  workoutExerciseId: string,
): Promise<void> {
  edit(userId, sessionId, (workout) => {
    exerciseOf(workout, workoutExerciseId)
    workout.exercises = workout.exercises.filter((item) => item.id !== workoutExerciseId)
  })
}
export async function addSet(userId: string, sessionId: string, workoutExerciseId: string): Promise<void> {
  edit(userId, sessionId, (workout) => {
    const exercise = exerciseOf(workout, workoutExerciseId),
      previous = exercise.sets.at(-1)
    exercise.sets.push({
      id: randomUUID(),
      position: Math.max(-1, ...exercise.sets.map((item) => item.position)) + 1,
      kg: previous?.kg ?? null,
      reps: previous?.reps ?? null,
      isWarmup: false,
      completedAt: null,
    })
  })
}
export type SetPatch = Partial<Pick<WorkoutSetRow, 'kg' | 'reps' | 'isWarmup'>> & { completed?: boolean }
export async function updateSet(
  userId: string,
  sessionId: string,
  setId: string,
  patch: SetPatch,
): Promise<void> {
  edit(userId, sessionId, (workout) => {
    const set = setOf(workout, setId),
      { completed, ...fields } = patch
    Object.assign(
      set,
      fields,
      completed === undefined ? {} : { completedAt: completed ? new Date().toISOString() : null },
    )
  })
}
export async function removeSet(userId: string, sessionId: string, setId: string): Promise<void> {
  edit(userId, sessionId, (workout) => {
    setOf(workout, setId)
    for (const exercise of workout.exercises) exercise.sets = exercise.sets.filter((set) => set.id !== setId)
  })
}
export async function updateSessionNote(userId: string, sessionId: string, note: string): Promise<void> {
  edit(userId, sessionId, (workout) => {
    workout.note = note.trim() || null
  })
}
function previousBests(userId: string, sessionId: string, ids: string[]) {
  const rows = localSqlite.all<{ exercise_id: string; kg: number | null; reps: number | null }>(
    `SELECT e.exercise_id,s.kg,s.reps
    FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN workout_sessions w ON w.id=e.session_id
    WHERE w.user_id=? AND w.id<>? AND w.ended_at IS NOT NULL AND w.deleted_at IS NULL AND s.completed_at IS NOT NULL AND s.is_warmup=0`,
    [userId, sessionId],
  )
  const grouped = new Map<string, LoggedSet[]>()
  for (const row of rows)
    if (ids.includes(row.exercise_id))
      grouped.set(row.exercise_id, [...(grouped.get(row.exercise_id) ?? []), toLogged(row)])
  const bests = new Map<string, number>()
  for (const [id, sets] of grouped) {
    const best = bestE1rm(sets)
    if (best !== null) bests.set(id, best)
  }
  return bests
}
export class EmptyWorkoutError extends Error {
  constructor() {
    super('Complete at least one set before finishing')
  }
}
export async function finishSession(userId: string, sessionId: string): Promise<WorkoutCompletedEvent> {
  let event!: WorkoutCompletedEvent
  edit(userId, sessionId, (workout) => {
    if (workout.endedAt) throw new Error('Workout is already finished')
    const done = workout.exercises
      .map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.completedAt !== null) }))
      .filter((exercise) => exercise.sets.length > 0)
    if (!done.length) throw new EmptyWorkoutError()
    const stats = sessionStats(
      done.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        sets: exercise.sets.filter((set) => !set.isWarmup).map(toLogged),
      })),
      previousBests(
        userId,
        sessionId,
        done.map((exercise) => exercise.exerciseId),
      ),
    )
    workout.exercises = done
    workout.endedAt = new Date().toISOString()
    event = {
      type: 'workout.completed',
      sessionId,
      userId,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt,
      durationSec: Math.round((Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 1000),
      ...stats,
    }
  })
  return event
}
export async function discardSession(userId: string, sessionId: string): Promise<void> {
  edit(userId, sessionId, (workout) => {
    if (workout.endedAt) throw new Error('Finished workouts must be deleted from history')
    workout.deletedAt = new Date().toISOString()
  })
}
export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  edit(userId, sessionId, (workout) => {
    workout.deletedAt = new Date().toISOString()
  })
}
