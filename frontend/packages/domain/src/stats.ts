import { bestE1rm } from './e1rm'
import { startOfWeek } from './streak'
import type { LoggedSet } from './types'

const DAY = 86_400_000

export const volumeKg = (sets: LoggedSet[]) => sets.reduce((sum, s) => sum + (s.kg ?? 0) * s.reps, 0)

export interface ExercisePerformance {
  exerciseId: string
  sets: LoggedSet[]
}

export interface SessionStats {
  sets: number
  volumeKg: number
  prExerciseIds: string[]
}

export function sessionStats(
  performances: ExercisePerformance[],
  previousBest: ReadonlyMap<string, number>,
): SessionStats {
  const prExerciseIds: string[] = []
  for (const p of performances) {
    const best = bestE1rm(p.sets)
    const before = previousBest.get(p.exerciseId)
    if (best != null && before != null && best > before) prExerciseIds.push(p.exerciseId)
  }
  const all = performances.flatMap((p) => p.sets)
  return { sets: all.length, volumeKg: volumeKg(all), prExerciseIds }
}

export interface WeekBucket {
  weekStart: Date
  sessions: number
  volumeKg: number
}

/** Last `weeks` calendar weeks (Monday start), oldest first, including the current one. */
export function weeklyBuckets(
  sessions: { startedAt: Date; volumeKg: number }[],
  weeks: number,
  now = new Date(),
  timeZone?: string,
): WeekBucket[] {
  const buckets: WeekBucket[] = []
  let week = startOfWeek(now, timeZone)
  for (let i = 0; i < weeks; i++) {
    buckets.unshift({ weekStart: week, sessions: 0, volumeKg: 0 })
    week = startOfWeek(new Date(week.getTime() - 3 * DAY))
  }
  const byStart = new Map(buckets.map((b) => [b.weekStart.getTime(), b]))
  for (const s of sessions) {
    const b = byStart.get(startOfWeek(s.startedAt, timeZone).getTime())
    if (!b) continue
    b.sessions++
    b.volumeKg += s.volumeKg
  }
  return buckets
}
