import { describe, expect, it } from 'vitest'
import { nextTarget } from './progression'
import type { LoggedSet, ProgressRule } from './types'

const linear: ProgressRule = { kind: 'linear', incrementKg: 2.5, fails: 3, deloadPct: 10 }
const double: ProgressRule = { ...linear, kind: 'double' }
const rx5 = { sets: 3, repLow: 5, repHigh: 5 }
const rx812 = { sets: 3, repLow: 8, repHigh: 12 }
const s = (kg: number | null, ...reps: number[]): LoggedSet[] => reps.map((r) => ({ kg, reps: r }))

describe('nextTarget', () => {
  it('starts with no history', () => {
    expect(nextTarget(linear, rx5, [])).toEqual({ kg: null, reps: 5, move: 'start' })
  })

  it('linear adds weight when all sets hit', () => {
    expect(nextTarget(linear, rx5, [s(60, 5, 5, 5)])).toEqual({ kg: 62.5, reps: 5, move: 'up' })
  })

  it('linear holds after a miss', () => {
    expect(nextTarget(linear, rx5, [s(60, 5, 5, 4)])).toEqual({ kg: 60, reps: 5, move: 'hold' })
  })

  it('does not progress when fewer sets than prescribed were done', () => {
    expect(nextTarget(linear, rx5, [s(60, 5, 5)]).move).toBe('hold')
  })

  it('linear deloads after N consecutive fails at same weight', () => {
    const h = [s(60, 5, 4, 3), s(60, 5, 5, 4), s(60, 4, 4, 4), s(57.5, 5, 5, 5)]
    expect(nextTarget(linear, rx5, h)).toEqual({ kg: 54, reps: 5, move: 'deload' })
  })

  it('fails at a different weight do not count', () => {
    const h = [s(60, 5, 4, 3), s(57.5, 4, 4, 4), s(57.5, 4, 4, 4)]
    expect(nextTarget(linear, rx5, h).move).toBe('hold')
  })

  it('double climbs reps inside the range', () => {
    expect(nextTarget(double, rx812, [s(20, 10, 9, 9)])).toEqual({ kg: 20, reps: 10, move: 'reps' })
  })

  it('double adds weight at top of range', () => {
    expect(nextTarget(double, rx812, [s(20, 12, 12, 12)])).toEqual({ kg: 22.5, reps: 8, move: 'up' })
  })

  it('double holds below range', () => {
    expect(nextTarget(double, rx812, [s(20, 8, 7, 6)])).toEqual({ kg: 20, reps: 8, move: 'hold' })
  })

  it('bodyweight adds a rep', () => {
    expect(nextTarget(double, rx812, [s(null, 10, 9, 8)])).toEqual({ kg: null, reps: 9, move: 'reps' })
  })

  it('timed holds add seconds by step', () => {
    expect(nextTarget(double, { sets: 3, repLow: 30, repHigh: 60 }, [s(null, 40, 35, 30)], 5)).toEqual({
      kg: null,
      reps: 35,
      move: 'reps',
    })
  })

  it('manual keeps the weight', () => {
    expect(nextTarget({ ...linear, kind: 'manual' }, rx5, [s(40, 5, 5, 5)]).move).toBe('hold')
  })
})
