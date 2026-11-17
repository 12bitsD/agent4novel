import type Database from "better-sqlite3";

const schemaV1 = [
  {
    type: "table",
    name: "works",
    sql: `CREATE TABLE works (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    seed TEXT NOT NULL,
    config TEXT NOT NULL CHECK (json_valid(config)),
    created_at TEXT NOT NULL
  ) STRICT`,
  },
  {
    type: "table",
    name: "artifacts",
    sql: `CREATE TABLE artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    kind TEXT NOT NULL CHECK (
      kind IN ('caption','creative','outline','setting','beat','prose')
    ),
    chapter INTEGER,
    version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    content TEXT NOT NULL CHECK (json_valid(content)),
    human_status TEXT NOT NULL CHECK (human_status IN ('pending','approved')),
    created_at TEXT NOT NULL,
    inputs TEXT CHECK (inputs IS NULL OR json_valid(inputs)),
    CHECK (
      (kind IN ('caption','creative','outline','setting') AND chapter IS NULL)
      OR (
        kind IN ('beat','prose') AND chapter IS NOT NULL
        AND chapter BETWEEN 1 AND 9007199254740991
      )
    )
  ) STRICT`,
  },
  {
    type: "index",
    name: "artifact_work_version",
    sql: "CREATE UNIQUE INDEX artifact_work_version ON artifacts(work_id, kind, version) WHERE chapter IS NULL",
  },
  {
    type: "index",
    name: "artifact_chapter_version",
    sql: "CREATE UNIQUE INDEX artifact_chapter_version ON artifacts(work_id, kind, chapter, version) WHERE chapter IS NOT NULL",
  },
];

const additionsV2 = [
  {
    type: "table",
    name: "author_configs",
    sql: `CREATE TABLE author_configs (
    work_id TEXT NOT NULL REFERENCES works(id),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    request_id TEXT NOT NULL,
    expected_revision INTEGER NOT NULL,
    document TEXT NOT NULL CHECK (json_valid(document)),
    PRIMARY KEY (work_id, revision), UNIQUE (work_id, request_id)
  ) STRICT`,
  },
  {
    type: "table",
    name: "agent_files",
    sql: `CREATE TABLE agent_files (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    metadata TEXT NOT NULL CHECK (json_valid(metadata))
  ) STRICT`,
  },
];

const additionsV3 = [
  {
    type: "table",
    name: "bad_examples",
    sql: `CREATE TABLE bad_examples (
    id TEXT PRIMARY KEY NOT NULL,
    work_id TEXT NOT NULL REFERENCES works(id),
    chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 9007199254740991),
    record TEXT NOT NULL CHECK (json_valid(record)),
    request TEXT NOT NULL CHECK (json_valid(request))
  ) STRICT`,
  },
  {
    type: "index",
    name: "bad_example_work_chapter",
    sql: "CREATE INDEX bad_example_work_chapter ON bad_examples(work_id, chapter)",
  },
];

const additionsV4 = [
  {
    type: "table",
    name: "setting_extension_proposals",
    sql: `CREATE TABLE setting_extension_proposals (
    work_id TEXT NOT NULL REFERENCES works(id),
    request_id TEXT NOT NULL,
    record TEXT NOT NULL CHECK (json_valid(record)),
    PRIMARY KEY (work_id, request_id)
  ) STRICT`,
  },
];

const additionsV5 = [
  {
    type: "index",
    name: "artifact_work_head",
    sql: "CREATE INDEX artifact_work_head ON artifacts(work_id, kind, chapter, version)",
  },
  {
    type: "index",
    name: "agent_file_work",
    sql: "CREATE INDEX agent_file_work ON agent_files(work_id)",
  },
];

const schemaVersions = [
  schemaV1,
  additionsV2,
  additionsV3,
  additionsV4,
  additionsV5,
];
function buildExpectedSchemas() {
  const expected = [schemaV1];
  for (let index = 1; index < schemaVersions.length; index += 1) {
    // push：追加元素。
    // concat：处理当前步骤。
    expected.push(expected[index - 1]!.concat(schemaVersions[index]!));
  }
  return expected;
}
// buildExpectedSchemas：构造当前数据。
const expectedSchemas = buildExpectedSchemas();
const allSchemaObjects = expectedSchemas[4]!;

export class UnsupportedDatabaseError extends Error {
  readonly stage = "schema" as const;
  readonly sqliteCode = null;
  readonly attempts = 1;
  readonly retryable = false;
  readonly diagnosticCode = "unsupported-schema" as const;

  constructor() {
    // super：初始化父类错误。
    super("unsupported database schema");
    this.name = "UnsupportedDatabaseError";
  }
}

export type SqliteInitializationStage =
  | "open"
  | "foreign_keys"
  | "schema"
  | "wal"
  | "synchronous";

export class SqliteInitializationError extends Error {
  readonly stage: SqliteInitializationStage;
  readonly sqliteCode: string | null;
  readonly attempts: number;
  readonly retryable: boolean;
  readonly diagnosticCode = "initialization-error" as const;

  constructor(
    stage: SqliteInitializationStage,
    sqliteCode: string | null,
    attempts: number,
    retry: "retryable" | "terminal",
  ) {
    // super：初始化父类错误。
    super("database could not be opened");
    this.name = "SqliteInitializationError";
    this.stage = stage;
    this.sqliteCode = sqliteCode;
    this.attempts = attempts;
    this.retryable = retry === "retryable";
  }
}

export interface SqliteInitializationOptions {
  busyTimeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

const defaultInitializationOptions = {
  busyTimeoutMs: 100,
  maxAttempts: 8,
  retryDelayMs: 10,
} as const;

// Keep this an explicit result-code allowlist. In particular, SQLITE_LOCKED is
// not a transient cross-connection busy condition and must never be retried.
const retryableBusyCodes = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_BUSY_TIMEOUT",
]);

export function getSqliteErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function sleepSynchronously(milliseconds: number): void {
  if (milliseconds <= 0) {
    return;
  }
  // wait：处理当前步骤。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function optionNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  // isFinite：校验当前条件。
  return Number.isFinite(value) && value !== undefined && value >= minimum
    ? value
    : fallback;
}

/**
 * Open-time boundary only: foreign keys, schema migration, WAL and FULL
 * synchronous are retried as one operation. Runtime writes retain the
 * normal 5-second better-sqlite3 busy handler, restored by SqliteStore.
 */
function initializationOptions(options: SqliteInitializationOptions) {
  // optionNumber：处理当前步骤。
  const busyTimeoutMs = optionNumber(
    options.busyTimeoutMs,
    defaultInitializationOptions.busyTimeoutMs,
    1,
  );
  // min：处理当前步骤。
  // floor：处理当前步骤。
  // optionNumber：处理当前步骤。
  const maxAttempts = Math.min(
    20,
    Math.floor(
      optionNumber(
        options.maxAttempts,
        defaultInitializationOptions.maxAttempts,
        1,
      ),
    ),
  );
  // optionNumber：处理当前步骤。
  const retryDelayMs = optionNumber(
    options.retryDelayMs,
    defaultInitializationOptions.retryDelayMs,
    0,
  );
  return { busyTimeoutMs, maxAttempts, retryDelayMs };
}

function initializeOnce(
  db: Database.Database,
  busyTimeoutMs: number,
  state: {
    stage: SqliteInitializationStage;
    enter: (stage: SqliteInitializationStage) => void;
  },
  attempt: number,
): void {
  // pragma：处理当前步骤。
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  // pragma：处理当前步骤。
  db.pragma("foreign_keys = ON");
  // enter：标记执行阶段。
  state.enter("schema");
  // initializeSqliteSchema：处理当前步骤。
  initializeSqliteSchema(db);
  // enter：标记执行阶段。
  state.enter("wal");
  if (!db.memory) {
    // pragma：处理当前步骤。
    const journalMode = db.pragma("journal_mode = WAL", { simple: true });
    // toLowerCase：转换当前数据。
    // String：转换字符串。
    if (String(journalMode).toLowerCase() !== "wal") {
      throw new SqliteInitializationError(
        state.stage,
        null,
        attempt,
        "terminal",
      );
    }
  }
  // enter：标记执行阶段。
  state.enter("synchronous");
  // pragma：处理当前步骤。
  db.pragma("synchronous = FULL");
  // pragma：处理当前步骤。
  const synchronous = db.pragma("synchronous", { simple: true });
  // Number：转换数值。
  if (Number(synchronous) !== 2) {
    throw new SqliteInitializationError(state.stage, null, attempt, "terminal");
  }
}

export function initializeSqliteDatabase(
  db: Database.Database,
  options: SqliteInitializationOptions = {},
): void {
  // initializationOptions：处理当前步骤。
  const resolved = initializationOptions(options);
  // Number：转换数值。
  // pragma：处理当前步骤。
  const runtimeBusyTimeout = Number(
    db.pragma("busy_timeout", { simple: true }),
  );
  try {
    for (let attempt = 1; attempt <= resolved.maxAttempts; attempt += 1) {
      const state = {
        stage: "foreign_keys" as SqliteInitializationStage,
        enter(stage: SqliteInitializationStage) {
          this.stage = stage;
        },
      };
      try {
        // initializeOnce：处理当前步骤。
        initializeOnce(db, resolved.busyTimeoutMs, state, attempt);
        return;
      } catch (error) {
        if (error instanceof UnsupportedDatabaseError) {
          throw error;
        }
        if (error instanceof SqliteInitializationError && !error.retryable) {
          throw error;
        }
        // getSqliteErrorCode：读取当前数据。
        const code = getSqliteErrorCode(error);
        // has：检查存在性。
        const retryable = code !== undefined && retryableBusyCodes.has(code);
        if (!retryable || attempt === resolved.maxAttempts) {
          throw new SqliteInitializationError(
            state.stage,
            code ?? null,
            attempt,
            retryable ? "retryable" : "terminal",
          );
        }
        // sleepSynchronously：处理当前步骤。
        sleepSynchronously(resolved.retryDelayMs);
      }
    }
  } finally {
    // pragma：处理当前步骤。
    db.pragma(`busy_timeout = ${runtimeBusyTimeout}`);
  }
}

// trim：处理当前步骤。
// replace：处理当前步骤。
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();

// Re-read only after acquiring the writer lock: another process may have
// finished the first-open migration while this connection waited.
export function initializeSqliteSchema(db: Database.Database): void {
  // immediate：处理当前步骤。
  // transaction：处理当前步骤。
  db.transaction(() => {
    // pragma：处理当前步骤。
    const version = db.pragma("user_version", { simple: true });
    // all：处理当前步骤。
    // prepare：处理当前步骤。
    const objects = db
      .prepare(
        "SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name",
      )
      .all() as { type: string; name: string; sql: string }[];
    if (version === 0 && objects.length === 0) {
      for (const object of allSchemaObjects) {
        // exec：处理当前步骤。
        db.exec(object.sql);
      }
      // pragma：处理当前步骤。
      db.pragma("user_version = 5");
      return;
    }
    // includes：检查包含关系。
    // Number：转换数值。
    if (![1, 2, 3, 4, 5].includes(Number(version))) {
      throw new UnsupportedDatabaseError();
    }
    // Number：转换数值。
    const expectedSchema = expectedSchemas[Number(version) - 1]!;
    // some：检查任一匹配。
    if (
      objects.length !== expectedSchema.length ||
      objects.some((object) => {
        // find：查找元素。
        const expected = expectedSchema.find(
          (entry) => entry.name === object.name,
        );
        // normalize：转换当前数据。
        // normalize：转换当前数据。
        return (
          !expected ||
          expected.type !== object.type ||
          normalize(expected.sql) !== normalize(object.sql)
        );
      })
    ) {
      throw new UnsupportedDatabaseError();
    }
    // Number：转换数值。
    let index = Number(version);
    while (index < schemaVersions.length) {
      for (const object of schemaVersions[index]!) {
        // exec：处理当前步骤。
        db.exec(object.sql);
      }
      index += 1;
    }
    if (version !== 5) {
      // pragma：处理当前步骤。
      db.pragma("user_version = 5");
    }
  }).immediate();
}
