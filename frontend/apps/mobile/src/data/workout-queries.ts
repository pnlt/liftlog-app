import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { db } from './db/client'
import { workoutExercises, workoutSessions, workoutSets } from './db/schema'
import { activeWhere, finishedWhere } from './workouts'

/** Every query roots at `workout_sessions`: useLiveQuery only re-runs on changes to that table. */

const withChildren = {
  exercises: {
    orderBy: [asc(workoutExercises.position)],
    with: { sets: { orderBy: [asc(workoutSets.position)] } },
  },
}

export function useActiveSession(userId: string) {
  return useLiveQuery(
    db.query.workoutSessions.findFirst({ where: activeWhere(userId), with: withChildren }),
    [userId],
  )
}

export function useSession(sessionId: string) {
  return useLiveQuery(
    db.query.workoutSessions.findFirst({ where: eq(workoutSessions.id, sessionId), with: withChildren }),
    [sessionId],
  )
}

export type SessionWithChildren = NonNullable<ReturnType<typeof useSession>['data']>

const completedSetsJoin = and(
  eq(workoutSets.workoutExerciseId, workoutExercises.id),
  isNotNull(workoutSets.completedAt),
)

export function useHistory(userId: string, limit = 200) {
  return useLiveQuery(
    db
      .select({
        id: workoutSessions.id,
        startedAt: workoutSessions.startedAt,
        endedAt: workoutSessions.endedAt,
        note: workoutSessions.note,
        exercises: sql<number>`count(distinct ${workoutExercises.id})`,
        sets: sql<number>`count(${workoutSets.id})`,
        volumeKg: sql<number>`coalesce(sum(case when ${workoutSets.isWarmup} = 0 then ${workoutSets.kg} * ${workoutSets.reps} end), 0)`,
      })
      .from(workoutSessions)
      .leftJoin(workoutExercises, eq(workoutExercises.sessionId, workoutSessions.id))
      .leftJoin(workoutSets, completedSetsJoin)
      .where(finishedWhere(userId))
      .groupBy(workoutSessions.id)
      .orderBy(desc(workoutSessions.startedAt))
      .limit(limit),
    [userId, limit],
  )
}

export type HistoryItem = ReturnType<typeof useHistory>['data'][number]

export function useExerciseSets(userId: string, exerciseId: string) {
  return useLiveQuery(
    db
      .select({
        sessionId: workoutSessions.id,
        startedAt: workoutSessions.startedAt,
        kg: workoutSets.kg,
        reps: workoutSets.reps,
      })
      .from(workoutSessions)
      .innerJoin(workoutExercises, eq(workoutExercises.sessionId, workoutSessions.id))
      .innerJoin(workoutSets, completedSetsJoin)
      .where(
        and(
          finishedWhere(userId),
          eq(workoutExercises.exerciseId, exerciseId),
          eq(workoutSets.isWarmup, false),
        ),
      )
      .orderBy(asc(workoutSessions.startedAt), asc(workoutSets.position)),
    [userId, exerciseId],
  )
}
