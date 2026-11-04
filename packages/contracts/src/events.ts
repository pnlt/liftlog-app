import { z } from 'zod'

export const WorkoutCompletedEventSchema = z.object({
  type: z.literal('workout.completed'),
  sessionId: z.uuid(),
  userId: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  durationSec: z.int().nonnegative(),
  sets: z.int().nonnegative(),
  volumeKg: z.number().nonnegative(),
  prExerciseIds: z.array(z.string()),
})
export type WorkoutCompletedEvent = z.infer<typeof WorkoutCompletedEventSchema>

export type DomainEvent = WorkoutCompletedEvent
