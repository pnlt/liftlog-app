import type { Exercise } from '@myos/contracts'

export interface ExerciseSource {
  readonly name: string
  fetchAll(): Promise<unknown[]>
}

export type { Exercise }
