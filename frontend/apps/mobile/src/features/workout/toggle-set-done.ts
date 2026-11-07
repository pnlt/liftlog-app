import * as Haptics from 'expo-haptics'
import type { WorkoutSetRow } from '@/data/db/schema'
import { updateSet } from '@/data/workouts'
import { useRestTimer } from './rest-timer-store'

export function toggleSetDone(userId: string, sessionId: string, set: WorkoutSetRow, restSeconds: number) {
  const done = set.completedAt != null
  void Haptics.impactAsync(done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium)
  void updateSet(userId, sessionId, set.id, { completed: !done })
  if (!done) useRestTimer.getState().start(restSeconds)
}
