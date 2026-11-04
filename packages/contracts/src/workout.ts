import { ACTIVITIES, EXPERIENCES, GOALS, PACES, PLACES, SEXES, UNITS } from '@liftlog/domain'
import { z } from 'zod'

/** A session syncs whole: last-write-wins on `updatedAt`, deleted by tombstone (`deletedAt`).
 Weights are always kilograms; `unit` is display preference only. */
export const WorkoutSetSchema = z.object({
  id: z.uuid(),
  position: z.int().nonnegative(),
  kg: z.number().nonnegative().nullable(),
  reps: z.int().nonnegative().nullable(),
  isWarmup: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
})
export type WorkoutSet = z.infer<typeof WorkoutSetSchema>

export const WorkoutExerciseSchema = z.object({
  id: z.uuid(),
  exerciseId: z.string().min(1),
  position: z.int().nonnegative(),
  note: z.string().max(2000).nullable(),
  sets: z.array(WorkoutSetSchema),
})
export type WorkoutExercise = z.infer<typeof WorkoutExerciseSchema>

export const WorkoutSessionSchema = z.object({
  id: z.uuid(),
  userId: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  note: z.string().max(2000).nullable(),
  exercises: z.array(WorkoutExerciseSchema),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
})
export type WorkoutSession = z.infer<typeof WorkoutSessionSchema>

export const UserSettingsSchema = z.object({
  unit: z.enum(UNITS),
  restSeconds: z.int().min(0).max(600),
})
export type UserSettings = z.infer<typeof UserSettingsSchema>

export const UserProfileSchema = z.object({
  name: z.string().trim().min(1).max(40),
  sex: z.enum(SEXES),
  age: z.int().min(13).max(100),
  heightCm: z.number().min(120).max(230),
  weightKg: z.number().min(30).max(300),
  goal: z.enum(GOALS),
  experience: z.enum(EXPERIENCES),
  daysPerWeek: z.int().min(1).max(7),
  sessionMinutes: z.int().min(15).max(180),
  place: z.enum(PLACES),
  activity: z.enum(ACTIVITIES),
  pace: z.enum(PACES),
  updatedAt: z.iso.datetime(),
})
export type UserProfile = z.infer<typeof UserProfileSchema>
