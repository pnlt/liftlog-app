import { describe, expect, it } from 'vitest'
import { startOfWeek, weeklyProgress, weekStreak } from './streak'

const now = new Date(2026, 9, 28, 18)
const d = (m: number, day: number, h = 10) => new Date(2026, m, day, h)

describe('startOfWeek', () => {
  it('returns Monday', () => {
    expect(startOfWeek(now)).toEqual(new Date(2026, 9, 26))
    expect(startOfWeek(d(10, 1))).toEqual(new Date(2026, 9, 26))
  })
})

describe('weeklyProgress', () => {
  it('counts distinct days this week', () => {
    const dates = [d(9, 26), d(9, 26, 19), d(9, 27), d(9, 20)]
    expect(weeklyProgress(dates, 3, now)).toEqual({ done: 2, goal: 3, met: false })
  })
})

describe('weekStreak', () => {
  it('is zero with no data', () => {
    expect(weekStreak([], 3, now)).toBe(0)
  })

  it('current unfinished week does not break the streak', () => {
    const dates = [d(9, 19), d(9, 21), d(9, 12), d(9, 14)]
    expect(weekStreak(dates, 2, now)).toBe(2)
  })

  it('counts current week once met', () => {
    const dates = [d(9, 26), d(9, 27), d(9, 19), d(9, 21)]
    expect(weekStreak(dates, 2, now)).toBe(2)
  })

  it('a missed week resets', () => {
    const dates = [d(9, 19), d(9, 21), d(9, 5), d(9, 6)]
    expect(weekStreak(dates, 2, now)).toBe(1)
  })
})
