/// <reference types="node" />
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createSyncRepository, type SyncSqlite } from '../../data/sync/repository'
export const now = '2026-11-06T01:00:00.000Z'
export function accountDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  const journal = JSON.parse(
    readFileSync(new URL('../../data/db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
  ) as { entries: { tag: string }[] }
  for (const { tag } of journal.entries)
    db.exec(readFileSync(new URL(`../../data/db/migrations/${tag}.sql`, import.meta.url), 'utf8'))
  const sqlite: SyncSqlite = {
    run: (s, p = []) => {
      db.prepare(s).run(...p)
    },
    get: <T>(s: string, p: (string | number | null)[] = []) => db.prepare(s).get(...p) as T | undefined,
    all: <T>(s: string, p: (string | number | null)[] = []) => db.prepare(s).all(...p) as T[],
    transaction: (work) => {
      db.exec('BEGIN')
      try {
        const r = work()
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
  return { db, repository: createSyncRepository(sqlite, { uuid: randomUUID, now: () => now }) }
}
