import {
  SyncAckSchema,
  SyncChangeSchema,
  SyncMutationSchema,
  SyncPageSchema,
  SyncedSettingsSchema,
  TrainingStateSchema,
  type SyncAck,
  type SyncChange,
  type SyncEntityType,
  type SyncMutation,
  type SyncPage,
  type SyncPayload,
  type SyncWorkout,
  type SyncedSettings,
  type TrainingState,
} from '@myos/contracts'

export type SqlValue = string | number | null
/** The same synchronous transaction boundary is implemented by Expo and node:sqlite. */
export interface SyncSqlite {
  run(sql: string, params?: SqlValue[]): void
  get<T>(sql: string, params?: SqlValue[]): T | undefined
  all<T>(sql: string, params?: SqlValue[]): T[]
  transaction<T>(work: () => T): T
}
interface Entity {
  owner: string
  entity_type: SyncEntityType
  entity_id: string
  local_revision: number
  server_version: number
  local_json: string
  server_json: string | null
}
interface Intent {
  mutation_id: string
  owner: string
  entity_type: SyncEntityType
  entity_id: string
  local_revision: number
  predecessor_id: string | null
  base_version: number | null
  operation: SyncMutation['operation']
  payload_json: string
  body_json: string | null
  state: 'pending' | 'inflight' | 'conflict' | 'invalid'
  error: string | null
}
interface SessionRow {
  id: string
  user_id: string
  started_at: number
  ended_at: number | null
  note: string | null
  updated_at: number
  deleted_at: number | null
}
interface ExerciseRow {
  id: string
  exercise_id: string
  position: number
  note: string | null
  exercise_name: string | null
  exercise_load: 'weight' | 'bodyweight' | 'time' | null
}
interface SetRow {
  id: string
  position: number
  kg: number | null
  reps: number | null
  is_warmup: number
  completed_at: number | null
}
export interface SyncConflict {
  entityType: SyncEntityType
  entityId: string
  mutationId: string
  local: SyncPayload
  server: SyncChange | null
  state: 'conflict' | 'invalid'
  message: string | null
}
const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString())
const ms = (value: string | null) => (value === null ? null : Date.parse(value))
function utf8Bytes(value: string): number {
  let length = 0
  for (const character of value) {
    const point = character.codePointAt(0)!
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return length
}

export function createSyncRepository(sqlite: SyncSqlite, options: { uuid: () => string; now: () => string }) {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const key = (owner: string, type: SyncEntityType, id: string): SqlValue[] => [owner, type, id]
  function account(owner: string) {
    if (!owner.trim()) throw new Error('An account owner is required')
    sqlite.run('INSERT OR IGNORE INTO sync_accounts(owner) VALUES(?)', [owner])
  }
  const entity = (owner: string, type: SyncEntityType, id: string) =>
    sqlite.get<Entity>(
      'SELECT * FROM sync_entities WHERE owner=? AND entity_type=? AND entity_id=?',
      key(owner, type, id),
    )
  const intents = (owner: string, type: SyncEntityType, id: string) =>
    sqlite.all<Intent>(
      'SELECT * FROM sync_outbox WHERE owner=? AND entity_type=? AND entity_id=? ORDER BY sequence',
      key(owner, type, id),
    )
  const intent = (owner: string, id: string) =>
    sqlite.get<Intent>('SELECT * FROM sync_outbox WHERE owner=? AND mutation_id=?', [owner, id])

  function readWorkout(owner: string, id: string, legacy = false): SyncWorkout | null {
    const session = sqlite.get<SessionRow>('SELECT * FROM workout_sessions WHERE id=? AND user_id=?', [
      id,
      owner,
    ])
    if (!session) return null
    return {
      id: session.id,
      userId: session.user_id,
      startedAt: iso(session.started_at)!,
      endedAt: iso(session.ended_at),
      note: session.note,
      updatedAt: iso(session.updated_at)!,
      deletedAt: iso(session.deleted_at),
      exercises: sqlite
        .all<ExerciseRow>('SELECT * FROM workout_exercises WHERE session_id=? ORDER BY position', [id])
        .map((exercise) => {
          const catalog = legacy
            ? sqlite.get<{ name: string; load: 'weight' | 'bodyweight' | 'time' }>(
                'SELECT name,load FROM exercises WHERE id=?',
                [exercise.exercise_id],
              )
            : undefined
          const snapshot = exercise.exercise_name
            ? { name: exercise.exercise_name, load: exercise.exercise_load ?? ('weight' as const) }
            : legacy
              ? { name: catalog?.name ?? exercise.exercise_id, load: catalog?.load ?? ('weight' as const) }
              : undefined
          return {
            id: exercise.id,
            exerciseId: exercise.exercise_id,
            position: exercise.position,
            note: exercise.note,
            ...(snapshot ? { exerciseSnapshot: snapshot } : {}),
            sets: sqlite
              .all<SetRow>('SELECT * FROM workout_sets WHERE workout_exercise_id=? ORDER BY position', [
                exercise.id,
              ])
              .map((set) => ({
                id: set.id,
                position: set.position,
                kg: set.kg,
                reps: set.reps,
                isWarmup: set.is_warmup !== 0,
                completedAt: iso(set.completed_at),
              })),
          }
        }),
    }
  }

  function writeWorkout(owner: string, workout: SyncWorkout) {
    if (workout.userId !== owner) throw new Error('Workout belongs to another account')
    const existing = sqlite.get<{ user_id: string }>('SELECT user_id FROM workout_sessions WHERE id=?', [
      workout.id,
    ])
    if (existing && existing.user_id !== owner) throw new Error('Workout ID belongs to another account')
    for (const exercise of workout.exercises) {
      const original = sqlite.get<{ session_id: string }>(
        'SELECT session_id FROM workout_exercises WHERE id=?',
        [exercise.id],
      )
      if (original && original.session_id !== workout.id)
        throw new Error('Exercise ID belongs to another workout')
      for (const set of exercise.sets) {
        const originalSet = sqlite.get<{ workout_exercise_id: string }>(
          'SELECT workout_exercise_id FROM workout_sets WHERE id=?',
          [set.id],
        )
        if (originalSet && originalSet.workout_exercise_id !== exercise.id)
          throw new Error('Set ID belongs to another exercise')
      }
    }
    sqlite.run(
      `INSERT INTO workout_sessions(id,user_id,started_at,ended_at,note,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,ended_at=excluded.ended_at,note=excluded.note,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`,
      [
        workout.id,
        owner,
        ms(workout.startedAt),
        ms(workout.endedAt),
        workout.note,
        ms(workout.updatedAt),
        ms(workout.deletedAt),
      ],
    )
    sqlite.run('DELETE FROM workout_exercises WHERE session_id=?', [workout.id])
    for (const exercise of workout.exercises) {
      sqlite.run(
        'INSERT INTO workout_exercises(id,session_id,exercise_id,position,note,exercise_name,exercise_load) VALUES(?,?,?,?,?,?,?)',
        [
          exercise.id,
          workout.id,
          exercise.exerciseId,
          exercise.position,
          exercise.note,
          exercise.exerciseSnapshot?.name ?? null,
          exercise.exerciseSnapshot?.load ?? null,
        ],
      )
      for (const set of exercise.sets)
        sqlite.run(
          'INSERT INTO workout_sets(id,workout_exercise_id,position,kg,reps,is_warmup,completed_at) VALUES(?,?,?,?,?,?,?)',
          [set.id, exercise.id, set.position, set.kg, set.reps, set.isWarmup ? 1 : 0, ms(set.completedAt)],
        )
    }
  }

  function enqueue(
    owner: string,
    type: SyncEntityType,
    id: string,
    payload: SyncPayload,
    operation: SyncMutation['operation'],
  ) {
    account(owner)
    const old = entity(owner, type, id),
      revision = (old?.local_revision ?? 0) + 1
    const json = JSON.stringify(payload)
    sqlite.run(
      `INSERT INTO sync_entities(owner,entity_type,entity_id,local_revision,local_json) VALUES(?,?,?,?,?)
      ON CONFLICT(owner,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,local_json=excluded.local_json`,
      [...key(owner, type, id), revision, json],
    )
    const previous = intents(owner, type, id).at(-1)
    if (previous && !previous.body_json && previous.state === 'pending') {
      sqlite.run('UPDATE sync_outbox SET payload_json=?,operation=?,local_revision=? WHERE mutation_id=?', [
        json,
        previous.operation === 'importLegacyWorkout' ? 'importLegacyWorkout' : operation,
        revision,
        previous.mutation_id,
      ])
    } else {
      sqlite.run(
        `INSERT INTO sync_outbox(mutation_id,owner,entity_type,entity_id,local_revision,predecessor_id,base_version,operation,payload_json)
        VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          options.uuid(),
          owner,
          type,
          id,
          revision,
          previous?.mutation_id ?? null,
          previous ? null : (old?.server_version ?? 0),
          operation,
          json,
        ],
      )
    }
  }

  function project(owner: string, type: SyncEntityType, payload: SyncPayload) {
    if (type === 'workout') writeWorkout(owner, payload as SyncWorkout)
  }
  function storeShadow(owner: string, change: SyncChange) {
    if (change.entityType === 'workout' && change.payload.userId !== owner)
      throw new Error('Received workout for another account')
    const previous = entity(owner, change.entityType, change.entityId)
    if (previous && previous.server_version >= change.version) return
    sqlite.run(
      `INSERT INTO sync_entities(owner,entity_type,entity_id,local_json,server_version,server_json) VALUES(?,?,?,?,?,?)
      ON CONFLICT(owner,entity_type,entity_id) DO UPDATE SET server_version=excluded.server_version,server_json=excluded.server_json`,
      [
        ...key(owner, change.entityType, change.entityId),
        JSON.stringify(change.payload),
        change.version,
        JSON.stringify(change),
      ],
    )
  }
  function receive(owner: string, change: SyncChange) {
    storeShadow(owner, change)
    const pending = intent(owner, change.mutationId)
    if (pending) {
      if (pending.entity_type !== change.entityType || pending.entity_id !== change.entityId)
        throw new Error('Acknowledgment aggregate mismatch')
      sqlite.run('DELETE FROM sync_outbox WHERE owner=? AND mutation_id=?', [owner, pending.mutation_id])
      // This is the predecessor's actual commit version, not the latest observed shadow.
      sqlite.run(
        'UPDATE sync_outbox SET predecessor_id=NULL,base_version=? WHERE owner=? AND predecessor_id=?',
        [change.version, owner, pending.mutation_id],
      )
    }
    if (intents(owner, change.entityType, change.entityId).length === 0) {
      const latest = entity(owner, change.entityType, change.entityId)!
      const canonical = SyncChangeSchema.parse(JSON.parse(latest.server_json!))
      project(owner, canonical.entityType, canonical.payload)
      sqlite.run('UPDATE sync_entities SET local_json=? WHERE owner=? AND entity_type=? AND entity_id=?', [
        JSON.stringify(canonical.payload),
        ...key(owner, change.entityType, change.entityId),
      ])
    }
  }
  function transact<T>(work: () => T): T {
    const result = sqlite.transaction(work)
    notify()
    return result
  }
  function saveWorkout(owner: string, workout: SyncWorkout) {
    transact(() => {
      writeWorkout(owner, workout)
      enqueue(owner, 'workout', workout.id, workout, workout.deletedAt ? 'delete' : 'upsert')
    })
  }
  function editWorkout(owner: string, id: string, edit: (workout: SyncWorkout) => SyncWorkout) {
    transact(() => {
      const workout = readWorkout(owner, id)
      if (!workout || workout.deletedAt) throw new Error('Workout not found for this account')
      const updated = edit(workout)
      if (updated.id !== id) throw new Error('Cannot change workout ID')
      writeWorkout(owner, updated)
      enqueue(owner, 'workout', id, updated, updated.deletedAt ? 'delete' : 'upsert')
    })
  }

  const repo = {
    async prepare(owner: string): Promise<void> {
      transact(() => {
        account(owner)
        if (
          sqlite.get<{ imported: number }>('SELECT imported FROM sync_accounts WHERE owner=?', [owner])
            ?.imported
        )
          return
        for (const { id } of sqlite.all<{ id: string }>('SELECT id FROM workout_sessions WHERE user_id=?', [
          owner,
        ])) {
          if (entity(owner, 'workout', id)) continue
          const snapshot = readWorkout(owner, id, true)!
          // Persist unknown catalog metadata on the workout only, never the public catalog.
          writeWorkout(owner, snapshot)
          enqueue(owner, 'workout', id, snapshot, 'importLegacyWorkout')
        }
        sqlite.run('UPDATE sync_accounts SET imported=1 WHERE owner=?', [owner])
      })
    },
    next(owner: string): SyncMutation | null {
      return transact(() => {
        for (;;) {
          const pending = sqlite.get<Intent>(
            `SELECT o.* FROM sync_outbox o WHERE o.owner=? AND o.predecessor_id IS NULL
            AND o.state IN ('pending','inflight') AND NOT EXISTS(SELECT 1 FROM sync_outbox blocked WHERE blocked.owner=o.owner
            AND blocked.entity_type=o.entity_type AND blocked.entity_id=o.entity_id AND blocked.state IN ('conflict','invalid')) ORDER BY o.sequence LIMIT 1`,
            [owner],
          )
          if (!pending) return null
          if (pending.body_json) return SyncMutationSchema.parse(JSON.parse(pending.body_json))
          const parsed = SyncMutationSchema.safeParse({
            schemaVersion: 1,
            mutationId: pending.mutation_id,
            entityType: pending.entity_type,
            entityId: pending.entity_id,
            baseVersion: pending.base_version,
            operation: pending.operation,
            payload: JSON.parse(pending.payload_json),
          })
          const encoded = parsed.success ? JSON.stringify(parsed.data) : null
          if (!parsed.success || (encoded && utf8Bytes(encoded) > 1024 * 1024)) {
            sqlite.run("UPDATE sync_outbox SET state='invalid',error=? WHERE mutation_id=?", [
              parsed.success ? 'Workout exceeds the synchronization size limit' : parsed.error.message,
              pending.mutation_id,
            ])
            continue
          }
          sqlite.run("UPDATE sync_outbox SET body_json=?,state='inflight' WHERE mutation_id=?", [
            encoded,
            pending.mutation_id,
          ])
          return parsed.data
        }
      })
    },
    acknowledge(owner: string, ack: SyncAck): void {
      // A response captured for another account cannot consume this owner's intent.
      if (!intent(owner, ack.mutationId)) return
      const valid = SyncAckSchema.parse(ack)
      if (valid.mutationId !== valid.change.mutationId) throw new Error('Acknowledgment mutation mismatch')
      transact(() => {
        receive(owner, valid.change)
        sqlite.run('UPDATE sync_accounts SET last_synced_at=? WHERE owner=?', [options.now(), owner])
      })
    },
    applyPage(owner: string, page: SyncPage): void {
      const valid = SyncPageSchema.parse(page)
      transact(() => {
        account(owner)
        for (const change of valid.changes) receive(owner, change)
        sqlite.run('UPDATE sync_accounts SET cursor=max(cursor,?),last_synced_at=? WHERE owner=?', [
          valid.nextCursor,
          options.now(),
          owner,
        ])
      })
    },
    conflict(owner: string, mutationId: string, current: SyncChange | null): void {
      const pending = intent(owner, mutationId)
      if (!pending) return
      const valid = current === null ? null : SyncChangeSchema.parse(current)
      if (valid && (valid.entityType !== pending.entity_type || valid.entityId !== pending.entity_id))
        throw new Error('Conflict aggregate mismatch')
      transact(() => {
        if (valid) storeShadow(owner, valid)
        sqlite.run(
          "UPDATE sync_outbox SET state='conflict',error='This record changed on another device' WHERE owner=? AND mutation_id=?",
          [owner, mutationId],
        )
      })
    },
    reject(owner: string, mutationId: string, message: string): void {
      transact(() =>
        sqlite.run("UPDATE sync_outbox SET state='invalid',error=? WHERE owner=? AND mutation_id=?", [
          message,
          owner,
          mutationId,
        ]),
      )
    },
    retry(owner: string): void {
      transact(() =>
        sqlite.run(
          "UPDATE sync_outbox SET state=CASE WHEN body_json IS NULL THEN 'pending' ELSE 'inflight' END,error=NULL WHERE owner=? AND state='invalid'",
          [owner],
        ),
      )
    },
    status(owner: string) {
      const rows = sqlite.all<{ state: string; count: number }>(
        'SELECT state,count(*) AS count FROM sync_outbox WHERE owner=? GROUP BY state',
        [owner],
      )
      const count = (state: string) => rows.find((row) => row.state === state)?.count ?? 0
      return {
        pending: count('pending') + count('inflight'),
        conflicts: count('conflict'),
        invalid: count('invalid'),
        lastSyncedAt:
          sqlite.get<{ last_synced_at: string | null }>(
            'SELECT last_synced_at FROM sync_accounts WHERE owner=?',
            [owner],
          )?.last_synced_at ?? null,
      }
    },
    listConflicts(owner: string): SyncConflict[] {
      return sqlite
        .all<Intent>(
          "SELECT * FROM sync_outbox WHERE owner=? AND state IN ('conflict','invalid') ORDER BY sequence",
          [owner],
        )
        .map((row) => {
          const current = entity(owner, row.entity_type, row.entity_id)!
          return {
            entityType: row.entity_type,
            entityId: row.entity_id,
            mutationId: row.mutation_id,
            local: JSON.parse(current.local_json) as SyncPayload,
            server: current.server_json ? SyncChangeSchema.parse(JSON.parse(current.server_json)) : null,
            state: row.state as 'conflict' | 'invalid',
            message: row.error,
          }
        })
    },
    resolve(owner: string, type: SyncEntityType, id: string, choice: 'local' | 'server'): void {
      transact(() => {
        const current = entity(owner, type, id)
        const pending = intents(owner, type, id)
        if (!current || !pending.some((row) => row.state === 'conflict' || row.state === 'invalid')) return
        const server = current.server_json ? SyncChangeSchema.parse(JSON.parse(current.server_json)) : null
        const local = JSON.parse(current.local_json) as SyncPayload
        sqlite.run(
          'DELETE FROM sync_outbox WHERE owner=? AND entity_type=? AND entity_id=?',
          key(owner, type, id),
        )
        if (choice === 'server') {
          if (server) {
            project(owner, type, server.payload)
            sqlite.run(
              'UPDATE sync_entities SET local_json=? WHERE owner=? AND entity_type=? AND entity_id=?',
              [JSON.stringify(server.payload), ...key(owner, type, id)],
            )
          } else {
            // A rejected new draft has no server counterpart; retain it until explicitly edited.
            throw new Error('No server version is available; edit the local draft and retry')
          }
        } else if (server?.entityType === 'workout' && server.payload.deletedAt && type === 'workout') {
          project(owner, type, server.payload)
          sqlite.run(
            'UPDATE sync_entities SET local_json=? WHERE owner=? AND entity_type=? AND entity_id=?',
            [JSON.stringify(server.payload), ...key(owner, type, id)],
          )
          const draft = local as SyncWorkout
          const recovered: SyncWorkout = {
            ...draft,
            id: options.uuid(),
            deletedAt: null,
            updatedAt: options.now(),
            exercises: draft.exercises.map((exercise) => ({
              ...exercise,
              id: options.uuid(),
              sets: exercise.sets.map((set) => ({ ...set, id: options.uuid() })),
            })),
          }
          writeWorkout(owner, recovered)
          // The new child IDs may reference retired private catalog entries from the old workout.
          enqueue(owner, 'workout', recovered.id, recovered, 'importLegacyWorkout')
        } else {
          enqueue(
            owner,
            type,
            id,
            local,
            type === 'workout' && pending.some((row) => row.operation === 'importLegacyWorkout')
              ? 'importLegacyWorkout'
              : type === 'workout' && (local as SyncWorkout).deletedAt
                ? 'delete'
                : 'upsert',
          )
        }
      })
    },
    cursor(owner: string): number {
      return (
        sqlite.get<{ cursor: number }>('SELECT cursor FROM sync_accounts WHERE owner=?', [owner])?.cursor ?? 0
      )
    },
    backendUserId(owner: string): string | null {
      return (
        sqlite.get<{ backend_user_id: string | null }>(
          'SELECT backend_user_id FROM sync_accounts WHERE owner=?',
          [owner],
        )?.backend_user_id ?? null
      )
    },
    setBackendUserId(owner: string, id: string): void {
      transact(() => {
        account(owner)
        const previous = repo.backendUserId(owner)
        if (previous !== null && previous !== id)
          throw new Error('The server account identity changed. Contact support before reconnecting.')
        sqlite.run('UPDATE sync_accounts SET backend_user_id=? WHERE owner=?', [id, owner])
      })
    },
    hasBootstrapped(owner: string): boolean {
      return (
        sqlite.get<{ bootstrapped: number }>('SELECT bootstrapped FROM sync_accounts WHERE owner=?', [owner])
          ?.bootstrapped === 1
      )
    },
    setBootstrapped(owner: string): void {
      transact(() => {
        account(owner)
        sqlite.run('UPDATE sync_accounts SET bootstrapped=1 WHERE owner=?', [owner])
      })
    },
    readTrainingState(owner: string): TrainingState | null {
      const row = entity(owner, 'trainingState', 'self')
      return row ? TrainingStateSchema.parse(JSON.parse(row.local_json)) : null
    },
    saveTrainingState(owner: string, state: TrainingState): void {
      const valid = TrainingStateSchema.parse(state)
      transact(() => enqueue(owner, 'trainingState', 'self', valid, 'upsert'))
    },
    readSettings(owner: string): SyncedSettings | null {
      const row = entity(owner, 'settings', 'self')
      return row ? SyncedSettingsSchema.parse(JSON.parse(row.local_json)) : null
    },
    saveSettings(owner: string, settings: SyncedSettings): void {
      const valid = SyncedSettingsSchema.parse(settings)
      transact(() => enqueue(owner, 'settings', 'self', valid, 'upsert'))
    },
    subscribeSync(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    readWorkout,
    saveWorkout,
    editWorkout,
  }
  return repo
}
export type SyncRepository = ReturnType<typeof createSyncRepository>
