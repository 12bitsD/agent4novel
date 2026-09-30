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

const additions = [
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

export class UnsupportedDatabaseError extends Error {
  constructor() { super('unsupported database schema'); this.name = 'UnsupportedDatabaseError' }
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

// Re-read only after acquiring the writer lock: another process may have
// finished the first-open migration while this connection waited.
export function initializeSqliteSchema(db: Database.Database): void {
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true })
    const objects = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all() as { type: string; name: string; sql: string }[]
    if (version === 0 && objects.length === 0) {
      for (const object of [...schemaV1, ...additions]) db.exec(object.sql)
      db.pragma('user_version = 2')
      return
    }
    const expectedSchema = version === 1 ? schemaV1 : [...schemaV1, ...additions]
    if ((version !== 1 && version !== 2) || objects.length !== expectedSchema.length || objects.some(object => {
      const expected = expectedSchema.find(entry => entry.name === object.name)
      return !expected || expected.type !== object.type || normalize(expected.sql) !== normalize(object.sql)
    })) throw new UnsupportedDatabaseError()
    if (version === 1) {
      for (const object of additions) db.exec(object.sql)
      db.pragma('user_version = 2')
    }
  }).immediate()
}
