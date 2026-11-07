import type { LoggedSet } from './types'

export const e1rm = (s: LoggedSet) => (s.kg && s.reps > 0 ? s.kg * (1 + s.reps / 30) : null)

export function bestE1rm(sets: LoggedSet[]): number | null {
  let best: number | null = null
  for (const s of sets) {
    const v = e1rm(s)
    if (v != null && (best == null || v > best)) best = v
  }
  return best
}
