import library from './library.json'
import { SEED_EXERCISES } from './seed'
import type { ExerciseSource } from './source'

/** Bump when seed.ts or library.json changes so installed apps re-seed. */
export const BUNDLED_REVISION = '3'

const seedFrames: Partial<Record<string, string[]>> = library.seedFrames

const BUNDLED_EXERCISES: unknown[] = [
  ...SEED_EXERCISES.map((e) => {
    const frames = seedFrames[e.id] ?? []
    return { ...e, frames, imageUrl: frames[0] ?? e.imageUrl }
  }),
  ...library.exercises,
]

export const bundledSource: ExerciseSource = {
  name: 'bundled',
  fetchAll: async () => BUNDLED_EXERCISES,
}
