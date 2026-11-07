import { randomUUID } from 'expo-crypto'
import { sqlite } from '../db/client'
import { createSyncRepository, type SyncSqlite } from './repository'

export const localSqlite: SyncSqlite = {
  run: (sql, params = []) => {
    sqlite.runSync(sql, params)
  },
  get: <T>(sql: string, params: (string | number | null)[] = []) =>
    sqlite.getFirstSync<T>(sql, params) ?? undefined,
  all: <T>(sql: string, params: (string | number | null)[] = []) => sqlite.getAllSync<T>(sql, params),
  transaction: <T>(work: () => T): T => {
    let result!: T
    sqlite.withTransactionSync(() => {
      result = work()
    })
    return result
  },
}
export const syncRepository = createSyncRepository(localSqlite, {
  uuid: randomUUID,
  now: () => new Date().toISOString(),
})
export const {
  readTrainingState,
  saveTrainingState,
  readSettings,
  saveSettings,
  subscribeSync,
  hasBootstrapped,
  setBootstrapped,
} = syncRepository
export type { SyncRepository, SyncConflict } from './repository'
