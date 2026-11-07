import { expect, it } from 'vitest'
import { weeklyBuckets } from './stats'
import { weeklyProgress } from './streak'

it('uses the account calendar week across the UTC / Vietnam Monday boundary', () => {
  const session = { startedAt: new Date('2026-11-01T17:30:00Z'), volumeKg: 600 }
  const now = new Date('2026-11-02T01:00:00Z')
  expect(weeklyBuckets([session], 2, now, 'Asia/Ho_Chi_Minh').map((week) => week.volumeKg)).toEqual([0, 600])
  expect(weeklyBuckets([session], 2, now, 'UTC').map((week) => week.volumeKg)).toEqual([600, 0])
  expect(weeklyProgress([session.startedAt], 1, now, 'Asia/Ho_Chi_Minh')).toEqual({
    done: 1,
    goal: 1,
    met: true,
  })
})

it('keeps late Sunday in the previous Los Angeles week after the DST transition', () => {
  const session = { startedAt: new Date('2026-03-09T06:30:00Z'), volumeKg: 200 }
  const now = new Date('2026-03-09T12:00:00Z')
  expect(weeklyBuckets([session], 2, now, 'America/Los_Angeles').map((week) => week.volumeKg)).toEqual([
    200, 0,
  ])
  expect(weeklyBuckets([session], 2, now, 'UTC').map((week) => week.volumeKg)).toEqual([0, 200])
})
