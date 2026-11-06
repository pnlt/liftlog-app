import type { Exercise } from '@liftlog/contracts'

export interface ExerciseSource {
  readonly name: string
  fetchAll(): Promise<unknown[]>
}

export type { Exercise }
