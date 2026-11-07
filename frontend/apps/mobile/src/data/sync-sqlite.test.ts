/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncChange, SyncMutation, SyncWorkout, SyncedSettings } from '@myos/contracts'
import { createSyncRepository, type SyncSqlite } from './sync/repository'
const device = vi.hoisted(() => ({
  sqlite: null as SyncSqlite | null,
  repo: null as ReturnType<typeof createSyncRepository> | null,
}))
vi.mock('./sync', () => ({
  get localSqlite() {
    return device.sqlite!
  },
  get syncRepository() {
    return device.repo!
  },
}))
vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID }))
const owner = 'user_alice',
  other = 'user_bob',
  now = '2026-11-06T01:00:00.000Z'
const folders: string[] = [],
  connections: DatabaseSync[] = []
function open(path = ':memory:') {
  const db = new DatabaseSync(path)
  connections.push(db)
  db.exec('PRAGMA foreign_keys=ON')
  const sqlite: SyncSqlite = {
    run: (sql, params = []) => {
      db.prepare(sql).run(...params)
    },
    get: <T>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...params) as T[],
    transaction: (work) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
  return { db, sqlite, repo: createSyncRepository(sqlite, { uuid: randomUUID, now: () => now }) }
}
function migrate(db: DatabaseSync) {
  const journal = JSON.parse(
    readFileSync(new URL('./db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
  ) as { entries: { tag: string }[] }
  for (const { tag } of journal.entries)
    db.exec(readFileSync(new URL(`./db/migrations/${tag}.sql`, import.meta.url), 'utf8'))
}
function workout(note: string | null = null, userId = owner): SyncWorkout {
  return {
    id: randomUUID(),
    userId,
    startedAt: now,
    endedAt: null,
    note,
    exercises: [],
    updatedAt: now,
    deletedAt: null,
  }
}
function change(mutation: SyncMutation, version: number, revision = version): SyncChange {
  return {
    mutationId: mutation.mutationId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    version,
    revision,
    operation: mutation.operation === 'delete' ? 'delete' : 'upsert',
    payload: mutation.payload,
  } as SyncChange
}
const settings: SyncedSettings = {
  unit: 'kg',
  restSeconds: 90,
  demoStyle: 'art',
  timeZone: 'Asia/Ho_Chi_Minh',
}
afterEach(() => {
  for (const db of connections.splice(0)) {
    try {
      db.close()
    } catch {}
  }
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})
describe('durable SQLite synchronization', () => {
  it('freezes a transmitted mutation across edit, timeout and process restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'liftlog-sync-'))
    folders.push(folder)
    const path = join(folder, 'db.sqlite'),
      first = open(path)
    migrate(first.db)
    await first.repo.prepare(owner)
    const w = workout('first')
    first.repo.saveWorkout(owner, w)
    const sent = first.repo.next(owner)!
    first.repo.saveWorkout(owner, { ...w, note: 'newer' })
    first.db.close()
    const second = open(path)
    expect(second.repo.next(owner)).toEqual(sent)
    expect(second.repo.readWorkout(owner, w.id)?.note).toBe('newer')
    second.repo.acknowledge(owner, { mutationId: sent.mutationId, change: change(sent, 1) })
    expect(second.repo.next(owner)).toMatchObject({ baseVersion: 1, payload: { note: 'newer' } })
  })
  it('preserves causal base when a newer remote version precedes an old acknowledgment', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const w = workout('first')
    repo.saveWorkout(owner, w)
    const first = repo.next(owner)!
    repo.saveWorkout(owner, { ...w, note: 'second' })
    repo.applyPage(owner, {
      changes: [
        { ...change(first, 3), mutationId: randomUUID(), payload: { ...w, note: 'remote' } } as SyncChange,
      ],
      nextCursor: 3,
      hasMore: false,
    })
    repo.acknowledge(owner, { mutationId: first.mutationId, change: change(first, 2) })
    expect(repo.readWorkout(owner, w.id)?.note).toBe('second')
    expect(repo.next(owner)?.baseVersion).toBe(2)
  })
  it('recognizes its own feed echo and never rolls a newer shadow backward', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const w = workout()
    repo.saveWorkout(owner, w)
    const first = repo.next(owner)!
    repo.applyPage(owner, {
      changes: [
        { ...change(first, 2), mutationId: randomUUID(), payload: { ...w, note: 'remote' } } as SyncChange,
      ],
      nextCursor: 2,
      hasMore: false,
    })
    repo.acknowledge(owner, { mutationId: first.mutationId, change: change(first, 1) })
    expect(repo.readWorkout(owner, w.id)?.note).toBe('remote')
    expect(repo.status(owner).pending).toBe(0)
    repo.saveSettings(owner, settings)
    const setting = repo.next(owner)!
    repo.applyPage(owner, { changes: [change(setting, 1, 3)], nextCursor: 3, hasMore: false })
    expect(repo.status(owner).pending).toBe(0)
  })
  it('rolls the workout projection and outbox back together on failure', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    db.exec(
      "CREATE TRIGGER fail_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'disk failed'); END",
    )
    const w = workout()
    expect(() => repo.saveWorkout(owner, w)).toThrow('disk failed')
    expect(repo.readWorkout(owner, w.id)).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM workout_sessions').get()?.n).toBe(0)
  })
  it('partitions detail, write, pending data and incoming ownership', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    await repo.prepare(other)
    const w = workout()
    repo.saveWorkout(owner, w)
    const sent = repo.next(owner)!
    expect(repo.readWorkout(other, w.id)).toBeNull()
    expect(repo.next(other)).toBeNull()
    expect(() => repo.saveWorkout(other, { ...w, userId: other })).toThrow()
    expect(() =>
      repo.applyPage(other, { changes: [change(sent, 1)], nextCursor: 1, hasMore: false }),
    ).toThrow()
    repo.acknowledge(other, { mutationId: sent.mutationId, change: change(sent, 1) })
    expect(repo.status(owner).pending).toBe(1)
  })
  it('imports legacy sessions once with unknown snapshots and unfinished tombstones', async () => {
    const { db, repo } = open()
    migrate(db)
    const id = randomUUID(),
      exerciseId = randomUUID()
    db.prepare(
      'INSERT INTO workout_sessions(id,user_id,started_at,updated_at,deleted_at) VALUES(?,?,?,?,?)',
    ).run(id, owner, Date.parse(now), Date.parse(now), Date.parse(now))
    db.prepare(
      'INSERT INTO workout_exercises(id,session_id,exercise_id,position,note) VALUES(?,?,?,?,?)',
    ).run(exerciseId, id, 'retired-sanity-id', 0, 'original')
    await repo.prepare(owner)
    await repo.prepare(owner)
    const mutation = repo.next(owner)!
    expect(mutation).toMatchObject({
      entityId: id,
      operation: 'importLegacyWorkout',
      payload: {
        deletedAt: now,
        exercises: [
          {
            exerciseId: 'retired-sanity-id',
            exerciseSnapshot: { name: 'retired-sanity-id', load: 'weight' },
          },
        ],
      },
    })
    expect(repo.status(owner).pending).toBe(1)
    expect(repo.readSettings(owner)).toBeNull()
    expect(repo.readTrainingState(owner)).toBeNull()
  })
  it('restores a fresh cache including unknown exercise snapshots and cursor', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const w = {
      ...workout(),
      exercises: [
        {
          id: randomUUID(),
          exerciseId: 'unknown',
          position: 0,
          note: 'legacy',
          exerciseSnapshot: { name: 'Old squat', load: 'weight' as const },
          sets: [],
        },
      ],
    }
    const remote = {
      schemaVersion: 1,
      mutationId: randomUUID(),
      entityType: 'workout',
      entityId: w.id,
      baseVersion: 0,
      operation: 'upsert',
      payload: w,
    } as SyncMutation
    repo.applyPage(owner, { changes: [change(remote, 1, 10)], nextCursor: 10, hasMore: false })
    expect(repo.readWorkout(owner, w.id)).toEqual(w)
    expect(repo.cursor(owner)).toBe(10)
    expect(
      db.prepare('SELECT exercise_name FROM workout_exercises WHERE id=?').get(w.exercises[0]!.id)
        ?.exercise_name,
    ).toBe('Old squat')
    expect(repo.hasBootstrapped(owner)).toBe(false)
    repo.setBootstrapped(owner)
    expect(repo.hasBootstrapped(owner)).toBe(true)
  })
  it('retains conflict/rejection drafts and explicitly reconciles', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const w = workout('mine')
    repo.saveWorkout(owner, w)
    const sent = repo.next(owner)!
    const server = {
      ...change(sent, 5),
      mutationId: randomUUID(),
      payload: { ...w, note: 'theirs' },
    } as SyncChange
    repo.conflict(owner, sent.mutationId, server)
    expect(repo.status(owner).conflicts).toBe(1)
    expect(repo.listConflicts(owner)).toHaveLength(1)
    expect(repo.next(owner)).toBeNull()
    repo.resolve(owner, 'workout', w.id, 'local')
    const retry = repo.next(owner)!
    expect(retry).toMatchObject({ baseVersion: 5, payload: { note: 'mine' } })
    expect(retry.mutationId).not.toBe(sent.mutationId)
    repo.reject(owner, retry.mutationId, 'Invalid workout')
    expect(repo.status(owner).invalid).toBe(1)
    expect(repo.readWorkout(owner, w.id)?.note).toBe('mine')
    repo.retry(owner)
    expect(repo.next(owner)).toEqual(retry)
  })
  it('never resurrects a remotely deleted workout under its old ID', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const w = workout('recovery')
    repo.saveWorkout(owner, w)
    const sent = repo.next(owner)!
    const tombstone = {
      ...change(sent, 2),
      mutationId: randomUUID(),
      operation: 'delete',
      payload: { ...w, deletedAt: now },
    } as SyncChange
    repo.conflict(owner, sent.mutationId, tombstone)
    repo.resolve(owner, 'workout', w.id, 'local')
    const recovered = repo.next(owner)!
    expect(recovered.entityId).not.toBe(w.id)
    expect(recovered.baseVersion).toBe(0)
    expect(repo.readWorkout(owner, w.id)?.deletedAt).toBe(now)
    expect(recovered.payload).toMatchObject({ note: 'recovery', deletedAt: null })
  })
  it('advances a pull cursor only if the complete page commits', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const w = workout(),
      foreign = workout(null, other)
    const mutation = {
      schemaVersion: 1,
      mutationId: randomUUID(),
      entityType: 'workout',
      entityId: w.id,
      baseVersion: 0,
      operation: 'upsert',
      payload: w,
    } as SyncMutation
    const wrong = { ...mutation, entityId: foreign.id, payload: foreign } as SyncMutation
    expect(() =>
      repo.applyPage(owner, {
        changes: [change(mutation, 1), change(wrong, 1, 2)],
        nextCursor: 2,
        hasMore: false,
      }),
    ).toThrow()
    expect(repo.cursor(owner)).toBe(0)
    expect(repo.readWorkout(owner, w.id)).toBeNull()
  })
})

describe('workout actions use the durable owner-scoped transaction', () => {
  it('enqueues every action and keeps unfinished discards as synchronized tombstones', async () => {
    const { db, sqlite, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    device.sqlite = sqlite
    device.repo = repo
    const actions = await import('./workouts')
    db.prepare(
      "INSERT INTO exercises(id,name,primary_muscles,secondary_muscles,equipment,load,instructions,tips,updated_at) VALUES('squat','Squat','[]','[]','[]','weight','[]','[]',?)",
    ).run(Date.parse(now))
    let version = 0
    const confirmed = () => {
      const mutation = repo.next(owner)!
      expect(mutation.entityType).toBe('workout')
      repo.acknowledge(owner, { mutationId: mutation.mutationId, change: change(mutation, ++version) })
      return mutation.payload as SyncWorkout
    }
    const id = await actions.startSession(owner)
    expect(confirmed()).toMatchObject({ id, endedAt: null })
    await actions.addExercise(owner, id, 'squat')
    const exercise = confirmed().exercises[0]!
    expect(exercise.sets).toHaveLength(1)
    await actions.updateSet(owner, id, exercise.sets[0]!.id, { kg: 40, reps: 5, completed: true })
    expect(confirmed().exercises[0]!.sets[0]).toMatchObject({
      kg: 40,
      reps: 5,
      completedAt: expect.any(String),
    })
    await actions.addSet(owner, id, exercise.id)
    const extra = confirmed().exercises[0]!.sets[1]!
    await actions.removeSet(owner, id, extra.id)
    expect(confirmed().exercises[0]!.sets).toHaveLength(1)
    await actions.updateSessionNote(owner, id, ' notes ')
    expect(confirmed().note).toBe('notes')
    const completed = await actions.finishSession(owner, id)
    expect(completed.sessionId).toBe(id)
    expect(confirmed().endedAt).not.toBeNull()
    await expect(actions.finishSession(owner, id)).rejects.toThrow('already finished')
    await actions.deleteSession(owner, id)
    expect(confirmed().deletedAt).not.toBeNull()
    const discarded = await actions.startSession(owner)
    confirmed()
    await actions.addExercise(owner, discarded, 'squat')
    const discardedExercise = confirmed().exercises[0]!
    await actions.removeExercise(owner, discarded, discardedExercise.id)
    expect(confirmed().exercises).toHaveLength(0)
    await actions.discardSession(owner, discarded)
    const tombstone = confirmed()
    expect(tombstone.deletedAt).not.toBeNull()
    expect(tombstone.endedAt).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM workout_sessions WHERE user_id=?').get(owner)?.n).toBe(2)
  })
  it('rejects cross-account and cross-workout child writes without touching outboxes', async () => {
    const { db, sqlite, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    await repo.prepare(other)
    device.sqlite = sqlite
    device.repo = repo
    const actions = await import('./workouts')
    const first = workout(),
      second = workout(null, other),
      child = randomUUID(),
      setId = randomUUID()
    first.exercises = [
      {
        id: child,
        exerciseId: 'old-id',
        position: 0,
        note: null,
        sets: [{ id: setId, position: 0, kg: 20, reps: 3, isWarmup: false, completedAt: null }],
      },
    ]
    repo.saveWorkout(owner, first)
    repo.saveWorkout(other, second)
    await expect(actions.updateSet(other, first.id, setId, { kg: 999 })).rejects.toThrow()
    await expect(actions.updateSet(other, second.id, setId, { kg: 999 })).rejects.toThrow()
    await expect(actions.removeExercise(other, first.id, child)).rejects.toThrow()
    expect(repo.readWorkout(owner, first.id)?.exercises[0]!.sets[0]!.kg).toBe(20)
    expect(repo.status(owner).pending).toBe(1)
    expect(repo.status(other).pending).toBe(1)
  })
})

describe('upgrade and rejection recovery', () => {
  it('upgrades populated pre-sync SQLite without losing any historical fields', async () => {
    const { db, repo } = open()
    for (const tag of ['0000_init', '0001_illegal_zemo'])
      db.exec(readFileSync(new URL(`./db/migrations/${tag}.sql`, import.meta.url), 'utf8'))
    const id = randomUUID(),
      exerciseId = randomUUID(),
      setId = randomUUID()
    const startedAt = Date.parse(now) - 3600000,
      endedAt = Date.parse(now) - 1000
    db.prepare(
      'INSERT INTO workout_sessions(id,user_id,started_at,ended_at,note,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?)',
    ).run(id, owner, startedAt, endedAt, 'old note', endedAt, null)
    db.prepare(
      'INSERT INTO workout_exercises(id,session_id,exercise_id,position,note) VALUES(?,?,?,?,?)',
    ).run(exerciseId, id, 'retired-timed', 4, 'old exercise note')
    db.prepare(
      'INSERT INTO workout_sets(id,workout_exercise_id,position,kg,reps,is_warmup,completed_at) VALUES(?,?,?,?,?,?,?)',
    ).run(setId, exerciseId, 8, 10.25, 60, 1, endedAt)
    const journal = JSON.parse(
      readFileSync(new URL('./db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string }[] }
    for (const { tag } of journal.entries.slice(2))
      db.exec(readFileSync(new URL(`./db/migrations/${tag}.sql`, import.meta.url), 'utf8'))
    db.prepare('INSERT INTO accepted_plans(user_id,profile,result,accepted_at) VALUES(?,?,?,?)').run(
      owner,
      '{"draft":"preserved"}',
      '{}',
      now,
    )
    await repo.prepare(owner)
    const imported = repo.next(owner)!
    expect(imported.payload).toMatchObject({
      id,
      userId: owner,
      note: 'old note',
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      updatedAt: new Date(endedAt).toISOString(),
      deletedAt: null,
      exercises: [
        {
          id: exerciseId,
          exerciseId: 'retired-timed',
          position: 4,
          note: 'old exercise note',
          sets: [
            {
              id: setId,
              position: 8,
              kg: 10.25,
              reps: 60,
              isWarmup: true,
              completedAt: new Date(endedAt).toISOString(),
            },
          ],
        },
      ],
    })
    expect(db.prepare('SELECT profile FROM accepted_plans WHERE user_id=?').get(owner)?.profile).toBe(
      '{"draft":"preserved"}',
    )
    expect(repo.readTrainingState(owner)).toBeNull()
  })
  it('retains invalid local drafts while allowing another aggregate to sync and corrections to resolve', async () => {
    const { db, repo } = open()
    migrate(db)
    await repo.prepare(owner)
    const draft = workout('x'.repeat(2001))
    repo.saveWorkout(owner, draft)
    repo.saveSettings(owner, settings)
    expect(repo.next(owner)?.entityType).toBe('settings')
    expect(repo.status(owner).invalid).toBe(1)
    expect(repo.readWorkout(owner, draft.id)?.note).toHaveLength(2001)
    repo.editWorkout(owner, draft.id, (workout) => ({ ...workout, note: 'corrected' }))
    repo.resolve(owner, 'workout', draft.id, 'local')
    const pendingSettings = repo.next(owner)!
    repo.acknowledge(owner, { mutationId: pendingSettings.mutationId, change: change(pendingSettings, 1) })
    expect(repo.next(owner)).toMatchObject({ entityId: draft.id, payload: { note: 'corrected' } })
  })
  it('keeps the import checkpoint unset when enqueue fails and retries without duplication', async () => {
    const { db, repo } = open()
    migrate(db)
    const w = workout()
    db.prepare('INSERT INTO workout_sessions(id,user_id,started_at,updated_at) VALUES(?,?,?,?)').run(
      w.id,
      owner,
      Date.parse(now),
      Date.parse(now),
    )
    db.exec(
      "CREATE TRIGGER fail_import BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'no space'); END",
    )
    await expect(repo.prepare(owner)).rejects.toThrow('no space')
    expect(db.prepare('SELECT count(*) AS n FROM sync_accounts').get()?.n).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM workout_sessions').get()?.n).toBe(1)
    db.exec('DROP TRIGGER fail_import')
    await repo.prepare(owner)
    await repo.prepare(owner)
    expect(repo.status(owner).pending).toBe(1)
  })
})

it('freezes Unicode bodies without requiring a device TextEncoder global', async () => {
  const { db, repo } = open()
  migrate(db)
  await repo.prepare(owner)
  repo.saveWorkout(owner, workout('Tiếng Việt 🏋️'))
  vi.stubGlobal('TextEncoder', undefined)
  try {
    expect(repo.next(owner)?.payload).toMatchObject({ note: 'Tiếng Việt 🏋️' })
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('legacy workout reconciliation', () => {
  function insertLegacy(db: DatabaseSync) {
    const id = randomUUID(),
      exerciseId = randomUUID()
    db.prepare('INSERT INTO workout_sessions(id,user_id,started_at,updated_at) VALUES(?,?,?,?)').run(
      id,
      owner,
      Date.parse(now),
      Date.parse(now),
    )
    db.prepare(
      'INSERT INTO workout_exercises(id,session_id,exercise_id,position,note) VALUES(?,?,?,?,?)',
    ).run(exerciseId, id, 'retired-private-catalog', 0, 'historical exercise')
    return { id, exerciseId }
  }

  it('preserves the initial legacy import operation when correcting a rejected import', async () => {
    const { db, repo } = open()
    migrate(db)
    const { id } = insertLegacy(db)
    await repo.prepare(owner)
    const rejected = repo.next(owner)!
    expect(rejected.operation).toBe('importLegacyWorkout')
    repo.reject(owner, rejected.mutationId, 'Correct the note before importing')
    repo.editWorkout(owner, id, (workout) => ({ ...workout, note: 'corrected legacy draft' }))
    repo.resolve(owner, 'workout', id, 'local')
    const corrected = repo.next(owner)!
    expect(corrected).toMatchObject({
      operation: 'importLegacyWorkout',
      entityId: id,
      baseVersion: 0,
      payload: {
        note: 'corrected legacy draft',
        exercises: [
          {
            exerciseId: 'retired-private-catalog',
            exerciseSnapshot: { name: 'retired-private-catalog', load: 'weight' },
          },
        ],
      },
    })
    expect(corrected.mutationId).not.toBe(rejected.mutationId)
    expect(db.prepare('SELECT count(*) AS n FROM exercises').get()?.n).toBe(0)
  })

  it('recovers an acknowledged unknown legacy exercise through an import under fresh workout and child IDs', async () => {
    const { db, repo } = open()
    migrate(db)
    const { id, exerciseId } = insertLegacy(db)
    await repo.prepare(owner)
    const imported = repo.next(owner)!
    repo.acknowledge(owner, { mutationId: imported.mutationId, change: change(imported, 1) })
    repo.editWorkout(owner, id, (workout) => ({ ...workout, note: 'keep my historical workout' }))
    const local = repo.next(owner)!
    expect(local.operation).toBe('upsert')
    const deleted = {
      ...change(local, 2),
      mutationId: randomUUID(),
      operation: 'delete',
      payload: { ...(local.payload as SyncWorkout), deletedAt: now },
    } as SyncChange
    repo.conflict(owner, local.mutationId, deleted)
    repo.resolve(owner, 'workout', id, 'local')
    const recovered = repo.next(owner)!
    expect(recovered.operation).toBe('importLegacyWorkout')
    expect(recovered.entityId).not.toBe(id)
    expect(recovered).toMatchObject({
      baseVersion: 0,
      payload: {
        deletedAt: null,
        note: 'keep my historical workout',
        exercises: [
          {
            exerciseId: 'retired-private-catalog',
            exerciseSnapshot: { name: 'retired-private-catalog', load: 'weight' },
          },
        ],
      },
    })
    expect((recovered.payload as SyncWorkout).exercises[0]!.id).not.toBe(exerciseId)
    expect(repo.readWorkout(owner, id)?.deletedAt).toBe(now)
    expect(db.prepare('SELECT count(*) AS n FROM exercises').get()?.n).toBe(0)
  })
})

it('reconciles an initial import collision explicitly against the canonical version without dropping unknown historical children', async () => {
  const { db, repo } = open()
  migrate(db)
  const id = randomUUID(),
    childId = randomUUID()
  db.prepare('INSERT INTO workout_sessions(id,user_id,started_at,updated_at,note) VALUES(?,?,?,?,?)').run(
    id,
    owner,
    Date.parse(now),
    Date.parse(now),
    'my historical record',
  )
  db.prepare('INSERT INTO workout_exercises(id,session_id,exercise_id,position,note) VALUES(?,?,?,?,?)').run(
    childId,
    id,
    'unknown-local-history',
    0,
    'keep this child',
  )
  await repo.prepare(owner)
  const original = repo.next(owner)!
  expect(original).toMatchObject({ operation: 'importLegacyWorkout', baseVersion: 0 })
  const canonical = {
    ...change(original, 4),
    mutationId: randomUUID(),
    payload: { ...(original.payload as SyncWorkout), note: 'existing server record', exercises: [] },
  } as SyncChange
  repo.conflict(owner, original.mutationId, canonical)
  expect(repo.next(owner)).toBeNull()
  repo.resolve(owner, 'workout', id, 'local')
  const reconciled = repo.next(owner)!
  expect(reconciled).toMatchObject({
    entityId: id,
    operation: 'importLegacyWorkout',
    baseVersion: 4,
    payload: {
      note: 'my historical record',
      exercises: [
        {
          id: childId,
          exerciseId: 'unknown-local-history',
          note: 'keep this child',
          exerciseSnapshot: { name: 'unknown-local-history', load: 'weight' },
        },
      ],
    },
  })
  expect(reconciled.mutationId).not.toBe(original.mutationId)
  expect(db.prepare('SELECT count(*) AS n FROM exercises').get()?.n).toBe(0)
})
