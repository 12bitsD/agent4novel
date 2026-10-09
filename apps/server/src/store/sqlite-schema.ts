import type Database from 'better-sqlite3'

const schemaV1 = [
  { type: 'table', name: 'works', sql: `CREATE TABLE works (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    seed TEXT NOT NULL,
    config TEXT NOT NULL CHECK (json_valid(config)),
    created_at TEXT NOT NULL
  ) STRICT` },
  { type: 'table', name: 'artifacts', sql: `CREATE TABLE artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    kind TEXT NOT NULL CHECK (kind IN ('caption','creative','outline','setting','beat','prose')),
    chapter INTEGER,
    version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    content TEXT NOT NULL CHECK (json_valid(content)),
    human_status TEXT NOT NULL CHECK (human_status IN ('pending','approved')),
    created_at TEXT NOT NULL,
    inputs TEXT CHECK (inputs IS NULL OR json_valid(inputs)),
    CHECK (
      (kind IN ('caption','creative','outline','setting') AND chapter IS NULL)
      OR (kind IN ('beat','prose') AND chapter IS NOT NULL AND chapter BETWEEN 1 AND 9007199254740991)
    )
  ) STRICT` },
  { type: 'index', name: 'artifact_work_version', sql: 'CREATE UNIQUE INDEX artifact_work_version ON artifacts(work_id, kind, version) WHERE chapter IS NULL' },
  { type: 'index', name: 'artifact_chapter_version', sql: 'CREATE UNIQUE INDEX artifact_chapter_version ON artifacts(work_id, kind, chapter, version) WHERE chapter IS NOT NULL' },
]

const additionsV2 = [
  { type: 'table', name: 'author_configs', sql: `CREATE TABLE author_configs (
    work_id TEXT NOT NULL REFERENCES works(id),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    request_id TEXT NOT NULL,
    expected_revision INTEGER NOT NULL,
    document TEXT NOT NULL CHECK (json_valid(document)),
    PRIMARY KEY (work_id, revision), UNIQUE (work_id, request_id)
  ) STRICT` },
  { type: 'table', name: 'agent_files', sql: `CREATE TABLE agent_files (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    metadata TEXT NOT NULL CHECK (json_valid(metadata))
  ) STRICT` },
]

const additionsV3 = [
  { type: 'table', name: 'bad_examples', sql: `CREATE TABLE bad_examples (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 9007199254740991),
    record TEXT NOT NULL CHECK (json_valid(record)),
    request TEXT NOT NULL CHECK (json_valid(request))
  ) STRICT` },
  { type: 'index', name: 'bad_example_work_chapter', sql: 'CREATE INDEX bad_example_work_chapter ON bad_examples(work_id, chapter)' },
]

export class UnsupportedDatabaseError extends Error {
  readonly stage = 'schema' as const
  readonly sqliteCode = null
  readonly attempts = 1
  readonly retryable = false
  readonly diagnosticCode = 'unsupported-schema' as const

  constructor() { super('unsupported database schema'); this.name = 'UnsupportedDatabaseError' }
}

export type SqliteInitializationStage = 'open' | 'foreign_keys' | 'schema' | 'wal' | 'synchronous'

export class SqliteInitializationError extends Error {
  readonly stage: SqliteInitializationStage
  readonly sqliteCode: string | null
  readonly attempts: number
  readonly retryable: boolean
  readonly diagnosticCode = 'initialization-error' as const

  constructor(stage: SqliteInitializationStage, sqliteCode: string | null, attempts: number, retryable: boolean) {
    super('database could not be opened')
    this.name = 'SqliteInitializationError'
    this.stage = stage
    this.sqliteCode = sqliteCode
    this.attempts = attempts
    this.retryable = retryable
  }
}

export interface SqliteInitializationOptions {
  busyTimeoutMs?: number
  maxAttempts?: number
  retryDelayMs?: number
}

const defaultInitializationOptions = {
  busyTimeoutMs: 100,
  maxAttempts: 8,
  retryDelayMs: 10,
} as const

// Keep this an explicit result-code allowlist. In particular, SQLITE_LOCKED is
// not a transient cross-connection busy condition and must never be retried.
const retryableBusyCodes = new Set([
  'SQLITE_BUSY',
  'SQLITE_BUSY_RECOVERY',
  'SQLITE_BUSY_SNAPSHOT',
  'SQLITE_BUSY_TIMEOUT',
])

export function getSqliteErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function sleepSynchronously(milliseconds: number): void {
  if (milliseconds <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function optionNumber(value: number | undefined, fallback: number, minimum: number): number {
  return Number.isFinite(value) && value !== undefined && value >= minimum ? value : fallback
}

/**
 * Open-time boundary only: foreign keys, schema migration, WAL and FULL
 * synchronous are retried as one operation. Runtime writes retain the
 * normal 5-second better-sqlite3 busy handler, restored by SqliteStore.
 */
export function initializeSqliteDatabase(db: Database.Database, options: SqliteInitializationOptions = {}): void {
  const busyTimeoutMs = optionNumber(options.busyTimeoutMs, defaultInitializationOptions.busyTimeoutMs, 1)
  const maxAttempts = Math.min(20, Math.floor(optionNumber(options.maxAttempts, defaultInitializationOptions.maxAttempts, 1)))
  const retryDelayMs = optionNumber(options.retryDelayMs, defaultInitializationOptions.retryDelayMs, 0)
  const runtimeBusyTimeout = Number(db.pragma('busy_timeout', { simple: true }))

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let stage: SqliteInitializationStage = 'foreign_keys'
      try {
        // PRAGMA busy_timeout replaces the connection's busy handler. This is
        // deliberately short for each bounded initialization attempt.
        db.pragma(`busy_timeout = ${busyTimeoutMs}`)
        db.pragma('foreign_keys = ON')
        stage = 'schema'
        initializeSqliteSchema(db)
        stage = 'wal'
        if (!db.memory) {
          const journalMode = db.pragma('journal_mode = WAL', { simple: true })
          if (String(journalMode).toLowerCase() !== 'wal') throw new SqliteInitializationError(stage, null, attempt, false)
        }
        stage = 'synchronous'
        db.pragma('synchronous = FULL')
        const synchronous = db.pragma('synchronous', { simple: true })
        if (Number(synchronous) !== 2) throw new SqliteInitializationError(stage, null, attempt, false)
        return
      } catch (error) {
        if (error instanceof UnsupportedDatabaseError) throw error
        if (error instanceof SqliteInitializationError && !error.retryable) throw error
        const code = getSqliteErrorCode(error)
        const retryable = code !== undefined && retryableBusyCodes.has(code)
        if (!retryable || attempt === maxAttempts) throw new SqliteInitializationError(stage, code ?? null, attempt, retryable)
        sleepSynchronously(retryDelayMs)
      }
    }
  } finally {
    // Do not leave a caller's connection on the short initialization handler,
    // including when initialization fails and the caller keeps the handle.
    db.pragma(`busy_timeout = ${runtimeBusyTimeout}`)
  }
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

// Re-read only after acquiring the writer lock: another process may have
// finished the first-open migration while this connection waited.
export function initializeSqliteSchema(db: Database.Database): void {
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true })
    const objects = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all() as { type: string; name: string; sql: string }[]
    if (version === 0 && objects.length === 0) {
      for (const object of [...schemaV1, ...additionsV2, ...additionsV3]) db.exec(object.sql)
      db.pragma('user_version = 3')
      return
    }
    const expectedSchema = version === 1 ? schemaV1 : version === 2 ? [...schemaV1, ...additionsV2] : [...schemaV1, ...additionsV2, ...additionsV3]
    if (![1, 2, 3].includes(Number(version)) || objects.length !== expectedSchema.length || objects.some(object => {
      const expected = expectedSchema.find(entry => entry.name === object.name)
      return !expected || expected.type !== object.type || normalize(expected.sql) !== normalize(object.sql)
    })) throw new UnsupportedDatabaseError()
    if (version === 1) {
      for (const object of additionsV2) db.exec(object.sql)
    }
    if (version === 1 || version === 2) {
      for (const object of additionsV3) db.exec(object.sql)
      db.pragma('user_version = 3')
    }
  }).immediate()
}
