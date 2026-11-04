import type { Equipment, Load, Muscle } from '@liftlog/domain'
import { relations } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  primaryMuscles: text('primary_muscles', { mode: 'json' }).$type<Muscle[]>().notNull(),
  secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<Muscle[]>().notNull(),
  equipment: text('equipment', { mode: 'json' }).$type<Equipment[]>().notNull(),
  load: text('load').$type<Load>().notNull(),
  instructions: text('instructions', { mode: 'json' }).$type<string[]>().notNull(),
  tips: text('tips', { mode: 'json' }).$type<string[]>().notNull(),
  imageUrl: text('image_url'),
  frames: text('frames', { mode: 'json' }).$type<string[]>().notNull().default([]),
  videoUrl: text('video_url'),
  updatedAt: timestamp('updated_at').notNull(),
})

/** Aggregate root: child writes bump `updatedAt`, sync pushes whole sessions, deletes are tombstones. */
export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    note: text('note'),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [index('workout_sessions_user_started_idx').on(t.userId, t.startedAt)],
)

export const workoutExercises = sqliteTable(
  'workout_exercises',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    position: integer('position').notNull(),
    note: text('note'),
  },
  (t) => [
    index('workout_exercises_session_idx').on(t.sessionId),
    index('workout_exercises_exercise_idx').on(t.exerciseId),
  ],
)

export const workoutSets = sqliteTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kg: real('kg'),
    reps: integer('reps'),
    isWarmup: integer('is_warmup', { mode: 'boolean' }).notNull().default(false),
    completedAt: timestamp('completed_at'),
  },
  (t) => [index('workout_sets_exercise_idx').on(t.workoutExerciseId)],
)

export const workoutSessionsRelations = relations(workoutSessions, ({ many }) => ({
  exercises: many(workoutExercises),
}))

export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  session: one(workoutSessions, { fields: [workoutExercises.sessionId], references: [workoutSessions.id] }),
  sets: many(workoutSets),
}))

export const workoutSetsRelations = relations(workoutSets, ({ one }) => ({
  exercise: one(workoutExercises, {
    fields: [workoutSets.workoutExerciseId],
    references: [workoutExercises.id],
  }),
}))

export type ExerciseRow = typeof exercises.$inferSelect
export type WorkoutSessionRow = typeof workoutSessions.$inferSelect
export type WorkoutExerciseRow = typeof workoutExercises.$inferSelect
export type WorkoutSetRow = typeof workoutSets.$inferSelect
