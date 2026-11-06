import { describe, expect, it } from 'vitest'
import { ExerciseSchema, WorkoutSessionSchema } from './index'

const now = '2026-11-03T10:00:00.000Z'

describe('ExerciseSchema', () => {
  it('fills defaults for optional content', () => {
    const e = ExerciseSchema.parse({
      id: 'bench-press',
      name: 'Bench press',
      primaryMuscles: ['chest'],
      equipment: ['barbell', 'bench'],
      load: 'weight',
      updatedAt: now,
    })
    expect(e).toMatchObject({ secondaryMuscles: [], instructions: [], imageUrl: null, videoUrl: null })
  })

  it('rejects unknown muscles', () => {
    expect(() =>
      ExerciseSchema.parse({
        id: 'x',
        name: 'x',
        primaryMuscles: ['wings'],
        equipment: ['barbell'],
        load: 'weight',
        updatedAt: now,
      }),
    ).toThrow()
  })
})

describe('WorkoutSessionSchema', () => {
  it('rejects negative weight', () => {
    const id = '0b7e3c1a-5f2d-4c8e-9a1b-2d3e4f5a6b7c'
    const session = {
      id,
      updatedAt: now,
      deletedAt: null,
      userId: 'user_1',
      startedAt: now,
      endedAt: null,
      note: null,
      exercises: [
        {
          id,
          exerciseId: 'bench-press',
          position: 0,
          note: null,
          sets: [{ id, position: 0, kg: -5, reps: 5, isWarmup: false, completedAt: null }],
        },
      ],
    }
    expect(WorkoutSessionSchema.safeParse(session).success).toBe(false)
    session.exercises[0]!.sets[0]!.kg = 60
    expect(WorkoutSessionSchema.safeParse(session).success).toBe(true)
  })
})
