import type { LoggedSet, Prescription, ProgressRule, Target } from './types'

export const roundTo = (x: number, step: number) => Math.round(x / step) * step

const topKg = (sets: LoggedSet[]) => {
  const kgs = sets.map((s) => s.kg).filter((k): k is number => k != null && k > 0)
  return kgs.length ? Math.max(...kgs) : null
}

const minReps = (sets: LoggedSet[]) => Math.min(...sets.map((s) => s.reps))

const allHit = (sets: LoggedSet[], rx: Prescription, reps: number) =>
  sets.length >= rx.sets && sets.every((s) => s.reps >= reps)

export function nextTarget(
  rule: ProgressRule,
  rx: Prescription,
  history: LoggedSet[][],
  repStep = 1,
): Target {
  const sessions = history.filter((s) => s.length > 0)
  const last = sessions[0]
  if (!last) return { kg: null, reps: rx.repLow, move: 'start' }

  const kg = topKg(last)
  if (kg == null) {
    return { kg: null, reps: Math.min(minReps(last) + repStep, rx.repHigh * 2), move: 'reps' }
  }
  if (rule.kind === 'manual') return { kg, reps: rx.repLow, move: 'hold' }

  const goal = rule.kind === 'linear' ? rx.repLow : rx.repHigh
  if (allHit(last, rx, goal)) return { kg: kg + rule.incrementKg, reps: rx.repLow, move: 'up' }

  let fails = 0
  for (const s of sessions) {
    if (topKg(s) !== kg || minReps(s) >= rx.repLow) break
    fails++
  }
  if (fails >= rule.fails) {
    return { kg: Math.max(0, roundTo(kg * (1 - rule.deloadPct / 100), 0.5)), reps: rx.repLow, move: 'deload' }
  }
  if (rule.kind === 'double' && fails === 0) {
    return { kg, reps: Math.min(rx.repHigh, minReps(last) + 1), move: 'reps' }
  }
  return { kg, reps: rx.repLow, move: 'hold' }
}
