import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initializeSqliteDatabase, SqliteInitializationError, UnsupportedDatabaseError } from '../src/store/sqlite-schema.js'

const resources: Array<{ close: () => void }> = []
const directories: string[] = []
afterEach(() => {
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

it('retries a controlled busy lock and completes the full initialization', async () => {
  const path = databasePath()
  const holder = open(path)
  holder.exec('CREATE TABLE lock_holder (value INTEGER); BEGIN EXCLUSIVE; INSERT INTO lock_holder VALUES (1)')
  const contender = open(path)
  const release = setTimeout(() => holder.exec('ROLLBACK'), 30)

  try {
    initializeSqliteDatabase(contender, { busyTimeoutMs: 1, maxAttempts: 20, retryDelayMs: 5 })
  } finally {
    clearTimeout(release)
  }

  expect(contender.pragma('user_version', { simple: true })).toBe(3)
  expect(contender.pragma('journal_mode', { simple: true })).toBe('wal')
})

it('returns safe bounded diagnostics when the busy lock does not clear', () => {
  const path = databasePath()
  const holder = open(path)
  holder.exec('CREATE TABLE lock_holder (value INTEGER); BEGIN EXCLUSIVE; INSERT INTO lock_holder VALUES (1)')
  const contender = open(path)

  expect(() => initializeSqliteDatabase(contender, { busyTimeoutMs: 1, maxAttempts: 2, retryDelayMs: 1 })).toThrow(SqliteInitializationError)
  try {
    initializeSqliteDatabase(contender, { busyTimeoutMs: 1, maxAttempts: 2, retryDelayMs: 1 })
  } catch (error) {
    expect(error).toMatchObject({ stage: 'schema', sqliteCode: 'SQLITE_BUSY', attempts: 2, retryable: true })
    expect(String(error)).not.toContain(path)
  }
})

it('does not turn an unsupported database into a retryable success', () => {
  const path = databasePath()
  const db = open(path)
  db.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserved'); PRAGMA user_version = 99")

  expect(() => initializeSqliteDatabase(db, { busyTimeoutMs: 1, maxAttempts: 5, retryDelayMs: 1 })).toThrow(UnsupportedDatabaseError)
  expect(db.prepare('SELECT * FROM sentinel').all()).toEqual([{ value: 'preserved' }])
})
