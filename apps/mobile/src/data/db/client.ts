import { drizzle } from 'drizzle-orm/expo-sqlite'
import { openDatabaseSync } from 'expo-sqlite'
import * as schema from './schema'

const sqlite = openDatabaseSync('liftlog.db', { enableChangeListener: true })
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

export const db = drizzle(sqlite, { schema })
export type Db = typeof db
