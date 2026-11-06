import { describe, expect, it } from 'vitest'
import { sessionStats, volumeKg, weeklyBuckets } from './stats'

describe('volumeKg', () => {
  it('ignores bodyweight sets', () => {
    expect(
      volumeKg([
        { kg: 100, reps: 5 },
        { kg: null, reps: 10 },
      ]),
    ).toBe(500)
  })
})

describe('sessionStats', () => {
  const perf = [
    { exerciseId: 'squat', sets: [{ kg: 100, reps: 5 }] },
    { exerciseId: 'bench', sets: [{ kg: 60, reps: 5 }] },
    { exerciseId: 'row', sets: [{ kg: 50, reps: 8 }] },
  ]

  it('flags only exercises that beat a previous best', () => {
    const before = new Map([
      ['squat', 110],
      ['bench', 80],
    ])
    expect(sessionStats(perf, before)).toEqual({ sets: 3, volumeKg: 1200, prExerciseIds: ['squat'] })
  })

  it('a first-ever session is not a PR', () => {
    expect(sessionStats(perf, new Map()).prExerciseIds).toEqual([])
  })
})

describe('weeklyBuckets', () => {
  const now = new Date(2026, 9, 28, 18)

  it('returns oldest-first Monday buckets and drops older sessions', () => {
    const b = weeklyBuckets(
      [
        { startedAt: new Date(2026, 9, 27), volumeKg: 1000 },
        { startedAt: new Date(2026, 9, 26), volumeKg: 500 },
        { startedAt: new Date(2026, 9, 20), volumeKg: 200 },
        { startedAt: new Date(2026, 8, 1), volumeKg: 999 },
      ],
      2,
      now,
    )
    expect(b.map((x) => x.weekStart)).toEqual([new Date(2026, 9, 19), new Date(2026, 9, 26)])
    expect(b.map((x) => [x.sessions, x.volumeKg])).toEqual([
      [1, 200],
      [2, 1500],
    ])
  })
})
