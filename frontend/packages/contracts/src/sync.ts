import { EQUIPMENT, LOADS, type Plan } from '@myos/domain'
import { z } from 'zod'
import { ExerciseSchema } from './exercise'
import {
  UserProfileSchema,
  UserSettingsSchema,
  WorkoutExerciseSchema,
  WorkoutSessionSchema,
  WorkoutSetSchema,
} from './workout'

const instant = z.iso.datetime()
const id = z.uuid()
const position = z.int().min(0).max(1_000_000)

export const ExerciseSnapshotSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    load: z.enum(LOADS),
  })
  .strict()

const setSchema = WorkoutSetSchema.extend({
  position,
  kg: z.number().min(0).max(10_000).nullable(),
  reps: z.int().min(0).max(1_000_000).nullable(),
}).strict()
const exerciseSchema = WorkoutExerciseSchema.extend({
  exerciseId: z.string().min(1).max(255),
  position,
  exerciseSnapshot: ExerciseSnapshotSchema.optional(),
  sets: z.array(setSchema).max(200),
}).strict()

export const SyncWorkoutSchema = WorkoutSessionSchema.extend({
  userId: z.string().min(1).max(255),
  exercises: z.array(exerciseSchema).max(100),
})
  .strict()
  .superRefine((session, ctx) => {
    const ids = new Set<string>()
    const positions = new Set<number>()
    for (const exercise of session.exercises) {
      if (ids.has(exercise.id) || positions.has(exercise.position))
        ctx.addIssue({ code: 'custom', message: 'Duplicate exercise ID or position' })
      ids.add(exercise.id)
      positions.add(exercise.position)
      const setPositions = new Set<number>()
      for (const set of exercise.sets) {
        if (ids.has(set.id) || setPositions.has(set.position))
          ctx.addIssue({ code: 'custom', message: 'Duplicate set ID or position' })
        ids.add(set.id)
        setPositions.add(set.position)
      }
    }
    if (session.endedAt && Date.parse(session.endedAt) < Date.parse(session.startedAt))
      ctx.addIssue({ code: 'custom', message: 'Session ends before it starts' })
  })
export type SyncWorkout = z.infer<typeof SyncWorkoutSchema>

export const PlanSummarySchema = z
  .object({
    phase: z.enum(['cut', 'recomp', 'maintain', 'leanBulk']),
    bmr: z.number().positive(),
    tdee: z.number().positive(),
    calories: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
    carbsG: z.number().nonnegative(),
    waterMl: z.number().nonnegative(),
    weeklyChangeKg: z.number(),
    split: z.enum(['fullBody', 'upperLower', 'pushPullLegs', 'hybrid']),
    setsPerMuscle: z.int().positive(),
    exercisesPerSession: z.int().positive(),
    repRange: z.tuple([z.int().positive(), z.int().positive()]),
    restSeconds: z.int().min(0).max(600),
    equipment: z.array(z.enum(EQUIPMENT)),
    bmi: z.number().positive(),
  })
  .strict() satisfies z.ZodType<Plan>

export const LegacyPlanSnapshotSchema = z
  .object({
    id,
    kind: z.literal('legacySummary'),
    calculationVersion: z.literal('1'),
    profileRevisionId: id,
    createdAt: instant,
    result: PlanSummarySchema,
  })
  .strict()
export type LegacyPlanSnapshot = z.infer<typeof LegacyPlanSnapshotSchema>

export const TrainingStateSchema = z
  .object({
    profileRevisionId: id.nullable(),
    profile: UserProfileSchema.strict().nullable(),
    plan: LegacyPlanSnapshotSchema.nullable(),
    onboardingCompletedAt: instant.nullable(),
  })
  .strict()
  .superRefine((state, ctx) => {
    if ((state.profile === null) !== (state.profileRevisionId === null))
      ctx.addIssue({ code: 'custom', message: 'Profile revision is required with profile' })
    if (state.plan && (!state.profile || state.plan.profileRevisionId !== state.profileRevisionId))
      ctx.addIssue({ code: 'custom', message: 'Plan belongs to another profile revision' })
    if (state.onboardingCompletedAt && !state.profile)
      ctx.addIssue({ code: 'custom', message: 'Completed onboarding requires a profile' })
  })
export type TrainingState = z.infer<typeof TrainingStateSchema>

export const SyncedSettingsSchema = UserSettingsSchema.extend({
  demoStyle: z.enum(['art', 'photo']),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return true
      } catch {
        return false
      }
    }, 'Unknown time zone'),
}).strict()
export type SyncedSettings = z.infer<typeof SyncedSettingsSchema>

export const SyncEntityTypeSchema = z.enum(['workout', 'trainingState', 'settings'])
export type SyncEntityType = z.infer<typeof SyncEntityTypeSchema>
const mutationFields = {
  schemaVersion: z.literal(1),
  mutationId: id,
  baseVersion: z.int().nonnegative(),
}
export const SyncMutationSchema = z
  .discriminatedUnion('entityType', [
    z
      .object({
        ...mutationFields,
        entityType: z.literal('workout'),
        entityId: id,
        operation: z.enum(['upsert', 'delete', 'importLegacyWorkout']),
        payload: SyncWorkoutSchema,
      })
      .strict(),
    z
      .object({
        ...mutationFields,
        entityType: z.literal('trainingState'),
        entityId: z.literal('self'),
        operation: z.literal('upsert'),
        payload: TrainingStateSchema,
      })
      .strict(),
    z
      .object({
        ...mutationFields,
        entityType: z.literal('settings'),
        entityId: z.literal('self'),
        operation: z.literal('upsert'),
        payload: SyncedSettingsSchema,
      })
      .strict(),
  ])
  .superRefine((mutation, ctx) => {
    if (mutation.entityType !== 'workout') return
    if (mutation.entityId !== mutation.payload.id)
      ctx.addIssue({ code: 'custom', message: 'Workout ID mismatch' })
    if (mutation.operation === 'delete' && !mutation.payload.deletedAt)
      ctx.addIssue({ code: 'custom', message: 'Deletion needs a tombstone' })
  })
export type SyncMutation = z.infer<typeof SyncMutationSchema>

const changeFields = { revision: z.int().positive(), mutationId: id, version: z.int().positive() }
export const SyncChangeSchema = z
  .discriminatedUnion('entityType', [
    z
      .object({
        ...changeFields,
        entityType: z.literal('workout'),
        entityId: id,
        operation: z.enum(['upsert', 'delete']),
        payload: SyncWorkoutSchema,
      })
      .strict(),
    z
      .object({
        ...changeFields,
        entityType: z.literal('trainingState'),
        entityId: z.literal('self'),
        operation: z.literal('upsert'),
        payload: TrainingStateSchema,
      })
      .strict(),
    z
      .object({
        ...changeFields,
        entityType: z.literal('settings'),
        entityId: z.literal('self'),
        operation: z.literal('upsert'),
        payload: SyncedSettingsSchema,
      })
      .strict(),
  ])
  .superRefine((change, ctx) => {
    if (
      change.entityType === 'workout' &&
      (change.entityId !== change.payload.id ||
        (change.operation === 'delete') !== (change.payload.deletedAt !== null))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Inconsistent workout change' })
    }
  })
export type SyncChange = z.infer<typeof SyncChangeSchema>
export type SyncPayload = SyncChange['payload']
export const SyncAckSchema = z.object({ mutationId: id, change: SyncChangeSchema }).strict()
export type SyncAck = z.infer<typeof SyncAckSchema>
export const SyncPageSchema = z
  .object({
    changes: z.array(SyncChangeSchema).max(200),
    nextCursor: z.int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((page, ctx) => {
    let previous = 0
    for (const change of page.changes) {
      if (change.revision <= previous || change.revision > page.nextCursor)
        ctx.addIssue({ code: 'custom', message: 'Invalid change cursor ordering' })
      previous = change.revision
    }
    if (page.hasMore && page.changes.length === 0)
      ctx.addIssue({ code: 'custom', message: 'An empty page cannot advance' })
  })
export type SyncPage = z.infer<typeof SyncPageSchema>
export const CatalogPageSchema = z
  .object({
    revision: z.string().min(1),
    items: z.array(ExerciseSchema).max(200),
    nextCursor: z.string().nullable(),
  })
  .strict()
export type CatalogPage = z.infer<typeof CatalogPageSchema>

export const VersionedTrainingStateSchema = z.object({
  version: z.int().nonnegative(),
  payload: TrainingStateSchema,
})
export const VersionedSettingsSchema = z.object({
  version: z.int().nonnegative(),
  payload: SyncedSettingsSchema,
})

export const WorkoutPageSchema = z
  .object({ items: z.array(SyncChangeSchema).max(200), nextCursor: z.string().nullable() })
  .superRefine((page, ctx) => {
    if (page.items.some((item) => item.entityType !== 'workout'))
      ctx.addIssue({ code: 'custom', message: 'Expected workout records' })
  })
export const PlanPageSchema = z.object({
  items: z.array(LegacyPlanSnapshotSchema).max(200),
  nextCursor: z.string().nullable(),
})
export const FitnessStatsSchema = z
  .object({
    timeZone: SyncedSettingsSchema.shape.timeZone,
    completedWorkouts: z.int().nonnegative(),
    completedSets: z.int().nonnegative(),
    volumeKg: z.number().nonnegative(),
    thisWeekWorkouts: z.int().nonnegative(),
    weeklyBuckets: z
      .array(
        z.object({ weekStart: instant, sessions: z.int().nonnegative(), volumeKg: z.number().nonnegative() }),
      )
      .max(104),
    weekStreak: z.int().nonnegative(),
    weeklyProgress: z.object({ done: z.int().nonnegative(), goal: z.int().min(1).max(7), met: z.boolean() }),
  })
  .strict()
export const ProgressPageSchema = z
  .object({
    exerciseId: z.string().min(1),
    timeZone: SyncedSettingsSchema.shape.timeZone,
    items: z
      .array(
        z
          .object({
            workoutId: id,
            startedAt: instant,
            endedAt: instant,
            completedSets: z.int().nonnegative(),
            volumeKg: z.number().nonnegative(),
            bestKg: z.number().nonnegative().nullable(),
            bestReps: z.int().nonnegative().nullable(),
            e1rm: z.number().nonnegative().nullable(),
          })
          .strict(),
      )
      .max(200),
    nextCursor: z.string().nullable(),
  })
  .strict()
