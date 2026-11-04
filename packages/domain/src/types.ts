export const MUSCLES = [
  'chest',
  'lats',
  'upperBack',
  'traps',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lowerBack',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
] as const
export type Muscle = (typeof MUSCLES)[number]

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'bench',
  'rack',
  'cable',
  'machine',
  'pullupBar',
  'band',
  'bodyweight',
] as const
export type Equipment = (typeof EQUIPMENT)[number]

/** How a set is measured: kg × reps, bodyweight reps, or seconds held (stored in `reps`). */
export const LOADS = ['weight', 'bodyweight', 'time'] as const
export type Load = (typeof LOADS)[number]

export const UNITS = ['kg', 'lb'] as const
export type Unit = (typeof UNITS)[number]

export type RuleKind = 'linear' | 'double' | 'manual'

export interface ProgressRule {
  kind: RuleKind
  incrementKg: number
  fails: number
  deloadPct: number
}

export interface Prescription {
  sets: number
  repLow: number
  repHigh: number
}

export interface LoggedSet {
  kg: number | null
  reps: number
}

export type Move = 'start' | 'up' | 'reps' | 'hold' | 'deload'

export interface Target {
  kg: number | null
  reps: number
  move: Move
}
