/// <reference types="node" />
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { buildPlan } from '@myos/domain'
import type { UserProfile } from '@myos/contracts'
import { accountDatabase, now } from './sqlite.test-helper'
import { createProfileModel } from './model'
const profile: UserProfile = {
  name: 'Alice',
  sex: 'female',
  age: 30,
  heightCm: 165,
  weightKg: 60,
  goal: 'getStronger',
  experience: 'beginner',
  daysPerWeek: 3,
  sessionMinutes: 60,
  place: 'gym',
  activity: 'desk',
  pace: 'standard',
  updatedAt: now,
}
function model(repository: ReturnType<typeof accountDatabase>['repository'], calculate = vi.fn(buildPlan)) {
  return {
    store: createStore(
      createProfileModel({ repository, uuid: randomUUID, now: () => now, buildPlan: calculate }),
    ),
    calculate,
  }
}
describe('account profile projection', () => {
  it('accepts profile and tagged plan with consistent references in one outbox snapshot', () => {
    const { db, repository } = accountDatabase()
    const { store, calculate } = model(repository)
    store.getState().hydrateAccount('alice')
    store.getState().setProfile(profile)
    const state = repository.readTrainingState('alice')!,
      mutation = repository.next('alice')!
    expect(state.profile).toEqual(profile)
    expect(state.onboardingCompletedAt).toBe(now)
    expect(state.plan).toMatchObject({
      kind: 'legacySummary',
      calculationVersion: '1',
      profileRevisionId: state.profileRevisionId,
      createdAt: now,
    })
    expect(mutation).toMatchObject({ entityType: 'trainingState', entityId: 'self', payload: state })
    expect(store.getState().plan).toEqual(state.plan?.result)
    expect(calculate).toHaveBeenCalledTimes(1)
    db.close()
  })
  it('hydrates the accepted plan without recomputing and reuses unchanged values', () => {
    const { db, repository } = accountDatabase()
    const first = model(repository)
    first.store.getState().hydrateAccount('alice')
    first.store.getState().setProfile(profile)
    const second = model(repository)
    second.store.getState().hydrateAccount('alice')
    const accepted = second.store.getState()
    expect(second.calculate).not.toHaveBeenCalled()
    expect(accepted.plan).toEqual(first.store.getState().plan)
    second.store.getState().hydrateAccount('alice')
    expect(second.store.getState().profile).toBe(accepted.profile)
    expect(second.store.getState().plan).toBe(accepted.plan)
    db.close()
  })
  it('keeps accepted state when editing is cancelled and during same-owner feed hydration', () => {
    const { db, repository } = accountDatabase()
    const { store } = model(repository)
    store.getState().hydrateAccount('alice')
    store.getState().setProfile(profile)
    const accepted = store.getState().plan
    store.getState().clearProfile()
    expect(store.getState().editing).toBe(true)
    expect(store.getState().profile).toEqual(profile)
    store.getState().hydrateAccount('alice')
    expect(store.getState().editing).toBe(true)
    store.getState().cancelEditing()
    expect(store.getState().editing).toBe(false)
    expect(store.getState().plan).toBe(accepted)
    expect(repository.status('alice').pending).toBe(1)
    db.close()
  })
  it('isolates owners and ignores stale actions captured before switching accounts', () => {
    const { db, repository } = accountDatabase()
    const { store } = model(repository)
    store.getState().hydrateAccount('alice')
    store.getState().setProfile(profile)
    const stale = store.getState().setProfile
    store.getState().clearProfile()
    store.getState().hydrateAccount('bob')
    expect(store.getState()).toMatchObject({ owner: 'bob', profile: null, plan: null, editing: false })
    stale({ ...profile, name: 'Wrong owner' })
    expect(repository.readTrainingState('bob')).toBeNull()
    expect(store.getState().profile).toBeNull()
    store.getState().hydrateAccount('alice')
    expect(store.getState().profile?.name).toBe('Alice')
    store.getState().hydrateAccount(null)
    expect(store.getState()).toMatchObject({ owner: null, profile: null, plan: null, editing: false })
    db.close()
  })
  it('does not replace accepted in-memory state when durable persistence fails', () => {
    const { db, repository } = accountDatabase()
    const { store } = model(repository)
    store.getState().hydrateAccount('alice')
    store.getState().setProfile(profile)
    repository.next('alice')
    db.exec(
      "CREATE TRIGGER fail_profile BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'disk full');END",
    )
    expect(() => store.getState().setProfile({ ...profile, name: 'unsaved' })).toThrow('disk full')
    expect(store.getState().profile?.name).toBe('Alice')
    expect(repository.readTrainingState('alice')?.profile?.name).toBe('Alice')
    db.close()
  })
})

it('projects onboarding reset and restore from the feed while preserving accepted profile and plan references', () => {
  const { db, repository } = accountDatabase()
  const { store } = model(repository)
  store.getState().hydrateAccount('alice')
  store.getState().setProfile(profile)
  const accepted = store.getState(),
    saved = repository.readTrainingState('alice')!,
    mutation = repository.next('alice')!
  expect(accepted.onboardingCompletedAt).toBe(now)
  const serverChange = (version: number, onboardingCompletedAt: string | null) => ({
    mutationId: version === 1 ? mutation.mutationId : randomUUID(),
    entityType: 'trainingState' as const,
    entityId: 'self' as const,
    version,
    revision: version,
    operation: 'upsert' as const,
    payload: { ...saved, onboardingCompletedAt },
  })
  repository.acknowledge('alice', { mutationId: mutation.mutationId, change: serverChange(1, now) })
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications++
  })
  repository.applyPage('alice', { changes: [serverChange(2, null)], nextCursor: 2, hasMore: false })
  store.getState().hydrateAccount('alice')
  expect(store.getState().onboardingCompletedAt).toBeNull()
  expect(store.getState().profile).toBe(accepted.profile)
  expect(store.getState().plan).toBe(accepted.plan)
  expect(notifications).toBe(1)
  const restoredAt = '2026-11-06T02:00:00.000Z'
  repository.applyPage('alice', { changes: [serverChange(3, restoredAt)], nextCursor: 3, hasMore: false })
  store.getState().hydrateAccount('alice')
  expect(store.getState().onboardingCompletedAt).toBe(restoredAt)
  expect(store.getState().profile).toBe(accepted.profile)
  expect(store.getState().plan).toBe(accepted.plan)
  expect(notifications).toBe(2)
  store.getState().hydrateAccount(null)
  expect(store.getState().onboardingCompletedAt).toBeNull()
  unsubscribe()
  db.close()
})
