import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import {
  artifactSchema, emptyAgentConfig, workCreateRequestSchema, workDetailSchema, workListResponseSchema, workSchema,
  type Artifact, type ArtifactKind, type HumanStatus, type JsonValue,
  type Work, type WorkCreateRequest, type WorkDetail, type WorkSummary,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import { assertBucketAddress, assertDirectStatusAllowed } from './invariants.js'
import { initializeSqliteSchema, UnsupportedDatabaseError } from './sqlite-schema.js'
import { StoreContractError, validateStoreValue } from './validation.js'
import type { AppendOptions, ArtifactPrecondition, FinalizeArtifactInput, SaveArtifactInput, WorkStore } from './work-store.js'

type WorkRow = { id: string; title: string; seed: string; config: string; created_at: string }
type ArtifactRow = { id: string; work_id: string; kind: string; chapter: number | null; version: number; content: string; human_status: string; created_at: string; inputs: string | null }

function parseJson(value: string): unknown {
  try { return JSON.parse(value) }
  catch { throw new StoreContractError('invalid-stored-data') }
}

function workFromRow(row: WorkRow): Work {
  return validateStoreValue(workSchema, { id: row.id, title: row.title, seed: row.seed, config: parseJson(row.config), createdAt: row.created_at }, 'stored')
}

function artifactFromRow(row: ArtifactRow): Artifact {
  return validateStoreValue(artifactSchema, {
    id: row.id, workId: row.work_id, kind: row.kind,
    ...(row.chapter === null ? {} : { chapter: row.chapter }),
    version: row.version, content: parseJson(row.content), humanStatus: row.human_status, createdAt: row.created_at,
    ...(row.inputs === null ? {} : { inputs: parseJson(row.inputs) }),
  }, 'stored')
}

export class SqliteStore implements WorkStore {
  private readonly db: Database.Database

  constructor(path: string) {
    let db: Database.Database | undefined
    try {
      // Exclusive creation sets private permissions without changing an existing
      // user's file. SQLite's in-memory path must not create a disk file.
      if (path !== ':memory:') {
        try { closeSync(openSync(path, 'wx', 0o600)) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      db = new Database(path, { timeout: 5000 })
      db.pragma('foreign_keys = ON')
      initializeSqliteSchema(db)
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = FULL')
      this.db = db
    } catch (error) {
      if (db?.open) db.close()
      if (error instanceof UnsupportedDatabaseError) throw error
      throw new Error('database could not be opened')
    }
  }

  close(): void { if (this.db.open) this.db.close() }

  private read<T>(fn: () => T): T { return this.db.transaction(fn).deferred() }
  private write<T>(fn: () => T): T { return this.db.transaction(fn).immediate() }

  private readWork(id: string): Work | undefined {
    const row = this.db.prepare('SELECT * FROM works WHERE id = ?').get(id) as WorkRow | undefined
    return row && workFromRow(row)
  }

  private requireWork(id: string): void {
    if (!this.readWork(id)) throw new KnownError('work-not-found', `work not found: ${id}`)
  }

  private head(workId: string, kind: ArtifactKind, chapter?: number): Artifact | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE work_id = ? AND kind = ? AND chapter IS ? ORDER BY version DESC LIMIT 1').get(workId, kind, chapter ?? null) as ArtifactRow | undefined
    return row && artifactFromRow(row)
  }

  private assertPreconditions(workId: string, kind: ArtifactKind, chapter: number | undefined, conditions: readonly ArtifactPrecondition[] = []): void {
    for (const condition of conditions) {
      assertBucketAddress(condition.kind, condition.chapter)
      const head = this.head(workId, condition.kind, condition.chapter)
      const matches = condition.head === null ? head === undefined
        : head?.id === condition.head.artifactId && head.version === condition.head.version && head.humanStatus === condition.head.humanStatus
      if (!matches) throw new KnownError(condition.kind === kind && condition.chapter === chapter ? 'version-conflict' : 'upstream-changed', `artifact precondition changed: ${workId}/${condition.kind}`)
    }
  }

  private makeWork(input: WorkCreateRequest): Work {
    const parsed = validateStoreValue(workCreateRequestSchema, input, 'input')
    return validateStoreValue(workSchema, {
      id: `work-${randomUUID()}`, title: parsed.title?.trim() || parsed.seed.slice(0, 20), seed: parsed.seed,
      config: structuredClone(emptyAgentConfig), createdAt: new Date().toISOString(),
    }, 'input')
  }

  private insertWork(work: Work): void {
    this.db.prepare('INSERT INTO works (id, title, seed, config, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(work.id, work.title, work.seed, JSON.stringify(work.config), work.createdAt)
  }

  createWork(input: WorkCreateRequest): Work {
    const work = this.makeWork(input)
    return this.write(() => { this.insertWork(work); return work })
  }

  createWorksIfEmpty(inputs: readonly WorkCreateRequest[]): boolean {
    return this.write(() => {
      if (this.db.prepare('SELECT 1 FROM works LIMIT 1').get()) return false
      const works = inputs.map(input => this.makeWork(input))
      for (const work of works) this.insertWork(work)
      return true
    })
  }

  private readDetail(id: string): WorkDetail | undefined {
    const work = this.readWork(id)
    if (!work) return undefined
    const rows = this.db.prepare(`SELECT a.* FROM artifacts a
      WHERE a.work_id = ? AND NOT EXISTS (
        SELECT 1 FROM artifacts newer WHERE newer.work_id = a.work_id AND newer.kind = a.kind
          AND newer.chapter IS a.chapter AND newer.version > a.version
      ) ORDER BY (SELECT MIN(first.rowid) FROM artifacts first WHERE first.work_id = a.work_id AND first.kind = a.kind AND first.chapter IS a.chapter)`).all(id) as ArtifactRow[]
    return validateStoreValue(workDetailSchema, { ...work, artifacts: rows.map(artifactFromRow) }, 'stored')
  }

  getWork(id: string): WorkDetail | undefined { return this.read(() => this.readDetail(id)) }

  listWorks(): WorkSummary[] {
    return this.read(() => {
      const rows = this.db.prepare('SELECT id FROM works ORDER BY rowid').all() as { id: string }[]
      return validateStoreValue(workListResponseSchema, rows.map(({ id }) => {
        const work = this.readDetail(id)!
        return { id: work.id, title: work.title, seedPreview: work.seed.length > 40 ? `${work.seed.slice(0, 40)}…` : work.seed,
          chapterCount: work.artifacts.filter(a => a.kind === 'prose' && a.humanStatus === 'approved').length }
      }), 'stored')
    })
  }

  private insertArtifact(artifact: Artifact): void {
    this.db.prepare('INSERT INTO artifacts (id, work_id, kind, chapter, version, content, human_status, created_at, inputs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(artifact.id, artifact.workId, artifact.kind, artifact.chapter ?? null, artifact.version, JSON.stringify(artifact.content), artifact.humanStatus, artifact.createdAt, artifact.inputs === undefined ? null : JSON.stringify(artifact.inputs))
  }

  appendArtifact(workId: string, kind: ArtifactKind, content: JsonValue, opts?: AppendOptions): Artifact {
    const options = structuredClone(opts)
    const storedContent = structuredClone(content)
    return this.write(() => {
      this.requireWork(workId)
      const chapter = options?.chapter
      assertBucketAddress(kind, chapter)
      if (options?.humanStatus === 'approved') assertDirectStatusAllowed(kind)
      this.assertPreconditions(workId, kind, chapter, options?.preconditions)
      const head = this.head(workId, kind, chapter)
      const artifact = validateStoreValue(artifactSchema, {
        id: `artifact-${randomUUID()}`, workId, kind, ...(chapter === undefined ? {} : { chapter }),
        version: (head?.version ?? 0) + 1, content: storedContent, humanStatus: options?.humanStatus ?? 'pending',
        createdAt: new Date().toISOString(), ...(options?.inputs === undefined ? {} : { inputs: options.inputs }),
      }, 'input')
      this.insertArtifact(artifact)
      return artifact
    })
  }

  finalizeArtifact(input: FinalizeArtifactInput): Artifact {
    const request = structuredClone(input)
    return this.write(() => {
      const { workId, kind, chapter } = request
      this.requireWork(workId)
      assertBucketAddress(kind, chapter)
      const head = this.head(workId, kind, chapter)
      if (!head || head.id !== request.expectedArtifactId || head.version !== request.expectedHeadVersion) throw new KnownError('version-conflict', `artifact head changed: ${workId}/${kind}`)
      if (head.humanStatus === 'approved') throw new KnownError('artifact-already-approved', `artifact already approved: ${workId}/${kind}`)
      this.assertPreconditions(workId, kind, chapter, request.preconditions)
      const artifact = validateStoreValue(artifactSchema, { ...head, content: request.content, humanStatus: 'approved' }, 'input')
      this.db.prepare('UPDATE artifacts SET content = ?, human_status = ? WHERE id = ?').run(JSON.stringify(artifact.content), artifact.humanStatus, artifact.id)
      return artifact
    })
  }

  saveArtifact(input: SaveArtifactInput): Artifact {
    const request = structuredClone(input)
    return this.write(() => {
      const { workId, kind, chapter } = request
      this.requireWork(workId)
      assertBucketAddress(kind, chapter)
      const head = this.head(workId, kind, chapter)
      if (!head || head.id !== request.expectedArtifactId || head.version !== request.expectedHeadVersion || head.humanStatus !== request.expectedHumanStatus) throw new KnownError('version-conflict', `artifact head changed: ${workId}/${kind}`)
      this.assertPreconditions(workId, kind, chapter, request.preconditions)
      const artifact = validateStoreValue(artifactSchema, { ...head, id: `artifact-${randomUUID()}`, version: head.version + 1, content: request.content, createdAt: new Date().toISOString() }, 'input')
      this.insertArtifact(artifact)
      return artifact
    })
  }

  setStatus(workId: string, kind: ArtifactKind, status: HumanStatus, opts?: { chapter?: number; preconditions?: readonly ArtifactPrecondition[] }): void {
    this.write(() => {
      assertDirectStatusAllowed(kind)
      assertBucketAddress(kind, opts?.chapter)
      this.assertPreconditions(workId, kind, opts?.chapter, opts?.preconditions)
      const head = this.head(workId, kind, opts?.chapter)
      if (!head) throw new KnownError('artifact-not-found', `artifact not found: ${workId}/${kind}`)
      const artifact = validateStoreValue(artifactSchema, { ...head, humanStatus: status }, 'input')
      this.db.prepare('UPDATE artifacts SET human_status = ? WHERE id = ?').run(artifact.humanStatus, artifact.id)
    })
  }

  headVersion(workId: string, kind: ArtifactKind, opts?: { chapter?: number }): number | undefined {
    return this.read(() => this.head(workId, kind, opts?.chapter)?.version)
  }
}
