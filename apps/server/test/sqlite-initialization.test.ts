import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initializeSqliteDatabase, SqliteInitializationError, UnsupportedDatabaseError } from '../src/store/sqlite-schema.js'
import { SqliteStore } from '../src/store/sqlite-store.js'

const resources: Array<{ close: () => void }> = []
const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const resource of resources.splice(0).reverse()) resource.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'a4n-sqlite-initialization-'))
  directories.push(directory)
  return join(directory, 'work.sqlite')
}

function open(path: string, timeout = 1): Database.Database {
  const db = new Database(path, { timeout })
  resources.push(db)
  return db
}

// At the real WAL pragma, acquire a real competing writer lock. Release it
// only after SQLite has reported BUSY, then rethrow that same error. No timer
// on the initializing thread, and no committed fixture table/unknown schema.
function busyWalOnce(holder: Database.Database): string[] {
  const pragma = Database.prototype.pragma
  const observed: string[] = []
  vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, source, options) {
    if (source === 'journal_mode = WAL' && observed.length === 0) {
      holder.exec('BEGIN IMMEDIATE')
      try { return pragma.call(this, source, options) }
      catch (error) {
        observed.push((error as { code: string }).code)
        throw error
      } finally { holder.exec('ROLLBACK') }
    }
    return pragma.call(this, source, options)
  })
  return observed
}

it('production constructor recovers after a real controlled WAL busy error', () => {
  const path = databasePath()
  const observed = busyWalOnce(open(path))
  const store = new SqliteStore(path)
  resources.push(store)
  expect(observed).toEqual(['SQLITE_BUSY'])
  expect(store.createWorksIfEmpty([{ seed: 'one' }, { seed: 'two' }])).toBe(true)
  expect(store.listWorks()).toHaveLength(2)
})

it('production constructor retains safe bounded busy diagnostics', () => {
  const path = databasePath()
  const holder = open(path)
  const pragma = Database.prototype.pragma
  vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, source, options) {
    if (source === 'journal_mode = WAL') {
      if (!holder.inTransaction) holder.exec('BEGIN IMMEDIATE')
      pragma.call(this, 'busy_timeout = 1')
    }
    return pragma.call(this, source, options)
  })
  expect(() => new SqliteStore(path)).toThrow(expect.objectContaining({
    stage: 'schema', sqliteCode: 'SQLITE_BUSY', retryable: true,
  }))
})

it('does not retry SQLITE_LOCKED as a busy condition', () => {
  const path = databasePath()
  const db = open(path)
  const pragma = Database.prototype.pragma
  vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, source, options) {
    if (source === 'foreign_keys = ON') throw Object.assign(new Error('locked'), { code: 'SQLITE_LOCKED' })
    return pragma.call(this, source, options)
  })

  expect(() => initializeSqliteDatabase(db, { busyTimeoutMs: 1, maxAttempts: 20, retryDelayMs: 1 })).toThrow(expect.objectContaining({
    stage: 'foreign_keys', sqliteCode: 'SQLITE_LOCKED', attempts: 1, retryable: false,
  }))
})

it('does not retry a migration SQL error and leaves the transaction recoverable', () => {
  const path = databasePath()
  const db = open(path)
  const exec = Database.prototype.exec
  let migrationAttempts = 0
  const failure = vi.spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database.Database, source) {
    if (source.includes('CREATE TABLE works')) {
      migrationAttempts += 1
      throw Object.assign(new Error('migration marker'), { code: 'SQLITE_ERROR' })
    }
    return exec.call(this, source)
  })

  expect(() => initializeSqliteDatabase(db, { busyTimeoutMs: 1, maxAttempts: 20, retryDelayMs: 1 })).toThrow(expect.objectContaining({
    stage: 'schema', sqliteCode: 'SQLITE_ERROR', attempts: 1, retryable: false,
  }))
  expect(migrationAttempts).toBe(1)
  failure.mockRestore()
  initializeSqliteDatabase(db, { busyTimeoutMs: 1, maxAttempts: 2, retryDelayMs: 1 })
  expect(db.pragma('user_version', { simple: true })).toBe(3)
})

it('retries a controlled busy lock and completes the full initialization', () => {
  const path = databasePath()
  const holder = open(path)
  const contender = open(path)
  const observed = busyWalOnce(holder)
  initializeSqliteDatabase(contender, { busyTimeoutMs: 1, maxAttempts: 20, retryDelayMs: 5 })

  expect(observed).toEqual(['SQLITE_BUSY'])
  expect(contender.pragma('user_version', { simple: true })).toBe(3)
  expect(contender.pragma('journal_mode', { simple: true })).toBe('wal')
  expect(contender.pragma('synchronous', { simple: true })).toBe(2)
  expect(contender.pragma('busy_timeout', { simple: true })).toBe(1)
})

it('returns safe bounded diagnostics when the busy lock does not clear', () => {
  const path = databasePath()
  const holder = open(path)
  holder.exec('BEGIN IMMEDIATE')
  const contender = open(path)

  expect(() => initializeSqliteDatabase(contender, { busyTimeoutMs: 1, maxAttempts: 2, retryDelayMs: 1 })).toThrow(SqliteInitializationError)
  try {
    initializeSqliteDatabase(contender, { busyTimeoutMs: 1, maxAttempts: 2, retryDelayMs: 1 })
  } catch (error) {
    expect(error).toMatchObject({ stage: 'schema', sqliteCode: 'SQLITE_BUSY', attempts: 2, retryable: true })
    expect(String(error)).not.toContain(path)
  }
  expect(contender.pragma('busy_timeout', { simple: true })).toBe(1)
})

it('keeps unsupported schema failures structured and safe', () => {
  const path = databasePath()
  const db = open(path)
  db.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserved'); PRAGMA user_version = 99")

  try {
    initializeSqliteDatabase(db, { busyTimeoutMs: 1, maxAttempts: 5, retryDelayMs: 1 })
  } catch (error) {
    expect(error).toMatchObject({ stage: 'schema', diagnosticCode: 'unsupported-schema', sqliteCode: null, attempts: 1, retryable: false })
    expect(String(error)).not.toContain(path)
  }
  expect(() => initializeSqliteDatabase(db, { busyTimeoutMs: 1, maxAttempts: 5, retryDelayMs: 1 })).toThrow(UnsupportedDatabaseError)
  expect(db.prepare('SELECT * FROM sentinel').all()).toEqual([{ value: 'preserved' }])
})
