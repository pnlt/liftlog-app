import type { Load, Target, Unit } from './types'

const LB = 2.20462

export const toDisplay = (kg: number, unit: Unit) =>
  unit === 'kg' ? Math.round(kg * 100) / 100 : Math.round(kg * LB * 10) / 10

export const fromDisplay = (v: number, unit: Unit) => (unit === 'kg' ? v : v / LB)

export const WEIGHT_STEPS: Record<Unit, readonly number[]> = { kg: [1.25, 2.5, 5, 10], lb: [2.5, 5, 10, 25] }
export const DEFAULT_WEIGHT_STEP: Record<Unit, number> = { kg: 2.5, lb: 5 }

/** Snapped to 2 decimals so repeated steps don't drift. */
export const stepValue = (value: number | null, delta: number) =>
  Math.max(0, Math.round(((value ?? 0) + delta) * 100) / 100)

export const fmtWeight = (kg: number | null, unit: Unit) =>
  kg == null ? 'BW' : `${toDisplay(kg, unit)}${unit}`

export const fmtTarget = (t: Target, unit: Unit, load: Load) =>
  load === 'time'
    ? `${t.reps}s`
    : t.move === 'start'
      ? `${t.reps} reps`
      : `${fmtWeight(t.kg, unit)} × ${t.reps}`
