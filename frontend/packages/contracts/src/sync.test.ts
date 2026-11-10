import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/sync.json'
import {
  FitnessStatsSchema,
  ProgressPageSchema,
  SyncChangeSchema,
  SyncMutationSchema,
  SyncedSettingsSchema,
} from './sync'

describe('synchronization boundary', () => {
  it('rejects malformed canonical statistics and negative estimated progress', () => {
    expect(
      FitnessStatsSchema.safeParse({ timeZone: 'UTC', completedWorkouts: 1, completedSets: 1, volumeKg: -10 })
        .success,
    ).toBe(false)
    expect(
      ProgressPageSchema.safeParse({
        exerciseId: 'bench-press',
        timeZone: 'UTC',
        nextCursor: null,
        items: [
          {
            workoutId: fixture.entityId,
            startedAt: fixture.payload.startedAt,
            endedAt: fixture.payload.endedAt,
            completedSets: 1,
            volumeKg: 600,
            bestKg: 60,
            bestReps: 10,
            e1rm: -80,
          },
        ],
      }).success,
    ).toBe(false)
  })
  it('preserves a legacy workout, its IDs, units and display snapshot', () => {
    const result = SyncMutationSchema.parse(fixture)
    expect(result).toEqual(fixture)
  })

  it.each([
    { entityType: 'settings' },
    { baseVersion: -1 },
    { entityId: 'another-workout' },
    { operation: 'delete' },
    { schemaVersion: 2 },
  ])('rejects mismatched mutation metadata %o', (patch) => {
    expect(SyncMutationSchema.safeParse({ ...fixture, ...patch }).success).toBe(false)
  })

  it('rejects child IDs reused across exercises', () => {
    const first = fixture.payload.exercises[0]!
    const copy = { ...first, id: '30000000-0000-4000-8000-000000000002', position: 1 }
    expect(
      SyncMutationSchema.safeParse({
        ...fixture,
        payload: { ...fixture.payload, exercises: [first, copy] },
      }).success,
    ).toBe(false)
  })

  it('rejects non-UTC timestamps and reversed session intervals', () => {
    for (const startedAt of ['2026-11-06T10:00:00+07:00', '2026-11-07T10:00:00.000Z']) {
      expect(
        SyncMutationSchema.safeParse({ ...fixture, payload: { ...fixture.payload, startedAt } }).success,
      ).toBe(false)
    }
  })

  it('requires a tombstone for a deletion and accepts it with the original snapshot', () => {
    expect(
      SyncMutationSchema.safeParse({
        ...fixture,
        operation: 'delete',
        payload: {
          ...fixture.payload,
          deletedAt: '2026-11-06T11:00:00.000Z',
        },
      }).success,
    ).toBe(true)
  })

  it('compares timestamp instants rather than fractional-second string spelling', () => {
    expect(
      SyncMutationSchema.safeParse({
        ...fixture,
        payload: {
          ...fixture.payload,
          startedAt: '2026-11-06T10:00:00Z',
          endedAt: '2026-11-06T10:00:00.000Z',
        },
      }).success,
    ).toBe(true)
  })

  it('rejects deleting singleton account settings', () => {
    expect(
      SyncMutationSchema.safeParse({
        ...fixture,
        entityType: 'settings',
        entityId: 'self',
        operation: 'delete',
        payload: {
          unit: 'kg',
          restSeconds: 90,
          demoStyle: 'art',
          timeZone: 'Asia/Ho_Chi_Minh',
        },
      }).success,
    ).toBe(false)
  })

  it('rejects invalid time zones and out-of-range settings', () => {
    const settings = { unit: 'kg', restSeconds: 90, demoStyle: 'art', timeZone: 'Asia/Ho_Chi_Minh' }
    expect(SyncedSettingsSchema.safeParse(settings).success).toBe(true)
    expect(SyncedSettingsSchema.safeParse({ ...settings, timeZone: 'Mars/Olympus' }).success).toBe(false)
    expect(SyncedSettingsSchema.safeParse({ ...settings, restSeconds: 601 }).success).toBe(false)
  })

  it('rejects a feed event whose operation contradicts its payload', () => {
    expect(
      SyncChangeSchema.safeParse({ ...fixture, revision: 1, version: 1, operation: 'delete' }).success,
    ).toBe(false)
  })
})
