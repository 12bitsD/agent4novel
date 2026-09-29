import { mkdirSync } from 'node:fs'
import type { ServerConfig } from '../config/server-config.js'
import { seedDemo } from '../seed.js'
import { SqliteStore } from '../store/sqlite-store.js'

export function openPersistentStore(config: ServerConfig): SqliteStore {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const store = new SqliteStore(config.databasePath)
  try {
    if (config.seedDemo) seedDemo(store)
    return store
  } catch (error) {
    store.close()
    throw error
  }
}
