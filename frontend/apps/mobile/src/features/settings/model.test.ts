import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { accountDatabase } from '../profile/sqlite.test-helper'
import { createSettingsModel } from './model'
describe('account settings projection', () => {
  it('starts from explicit defaults and persists every synchronized preference', () => {
    const { db, repository } = accountDatabase()
    const store = createStore(createSettingsModel({ repository, timeZone: () => 'Asia/Ho_Chi_Minh' }))
    expect(store.getState()).toMatchObject({
      owner: null,
      unit: 'kg',
      restSeconds: 90,
      demoStyle: 'art',
      timeZone: 'Asia/Ho_Chi_Minh',
    })
    store.getState().hydrateAccount('alice')
    expect(repository.readSettings('alice')).toBeNull()
    store.getState().setUnit('lb')
    store.getState().setRestSeconds(93.6)
    store.getState().setDemoStyle('photo')
    store.getState().setTimeZone('UTC')
    expect(repository.readSettings('alice')).toEqual({
      unit: 'lb',
      restSeconds: 94,
      demoStyle: 'photo',
      timeZone: 'UTC',
    })
    expect(repository.status('alice').pending).toBe(1)
    store.getState().setRestSeconds(900)
    expect(store.getState().restSeconds).toBe(600)
    store.getState().setRestSeconds(-10)
    expect(store.getState().restSeconds).toBe(0)
    db.close()
  })
  it('keeps defaults and cached settings partitioned and ignores stale owner setters', () => {
    const { db, repository } = accountDatabase()
    const store = createStore(createSettingsModel({ repository, timeZone: () => 'UTC' }))
    store.getState().hydrateAccount('alice')
    store.getState().setUnit('lb')
    const stale = store.getState().setUnit
    store.getState().hydrateAccount('bob')
    expect(store.getState().unit).toBe('kg')
    stale('lb')
    expect(repository.readSettings('bob')).toBeNull()
    store.getState().setDemoStyle('photo')
    store.getState().hydrateAccount('alice')
    expect(store.getState()).toMatchObject({ unit: 'lb', demoStyle: 'art' })
    store.getState().hydrateAccount(null)
    expect(store.getState()).toMatchObject({ owner: null, unit: 'kg', demoStyle: 'art' })
    store.getState().setUnit('lb')
    expect(store.getState().unit).toBe('kg')
    db.close()
  })
  it('hydrates incoming settings without creating another local intent', () => {
    const { db, repository } = accountDatabase()
    const store = createStore(createSettingsModel({ repository, timeZone: () => 'UTC' }))
    repository.saveSettings('alice', {
      unit: 'lb',
      restSeconds: 30,
      demoStyle: 'photo',
      timeZone: 'Asia/Tokyo',
    })
    const before = repository.status('alice').pending
    store.getState().hydrateAccount('alice')
    expect(store.getState()).toMatchObject({
      owner: 'alice',
      unit: 'lb',
      restSeconds: 30,
      demoStyle: 'photo',
      timeZone: 'Asia/Tokyo',
    })
    expect(repository.status('alice').pending).toBe(before)
    db.close()
  })
})
