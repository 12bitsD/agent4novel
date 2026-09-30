import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import {
  artifactSchema, emptyAgentConfig, workCreateRequestSchema, workDetailSchema, workListResponseSchema, workSchema,
  type Artifact, type ArtifactKind, type HumanStatus, type JsonValue,
  type Work, type WorkCreateRequest, type WorkDetail, type WorkSummary,
  authorConfigReceiptSchema, authorConfigSaveSchema, agentFileSchema, authorConfigLimits,
  type AuthorConfigReceipt, type AuthorConfigSave, type AgentFile,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import { assertBucketAddress, assertDirectStatusAllowed } from './invariants.js'
import { initializeSqliteSchema, UnsupportedDatabaseError } from './sqlite-schema.js'
import { StoreContractError, validateStoreValue } from './validation.js'
import type { AppendOptions, ArtifactPrecondition, FinalizeArtifactInput, SaveArtifactInput, WorkStore } from './work-store.js'
import type { AuthorConfigRepository } from '../config/author-config-repository.js'

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

export class SqliteStore implements WorkStore, AuthorConfigRepository {
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

  getAuthorConfig(workId: string): AuthorConfigReceipt | undefined {
    return this.read(() => {
      this.requireWork(workId)
      const row = this.db.prepare('SELECT * FROM author_configs WHERE work_id = ? ORDER BY revision DESC LIMIT 1').get(workId) as { revision: number; request_id: string; document: string } | undefined
      return row && validateStoreValue(authorConfigReceiptSchema, { workId, revision: row.revision, requestId: row.request_id, document: parseJson(row.document) }, 'stored')
    })
  }

  saveAuthorConfig(workId: string, input: AuthorConfigSave): AuthorConfigReceipt {
    const request = validateStoreValue(authorConfigSaveSchema, input, 'input')
    return this.write(() => {
      this.requireWork(workId)
      const prior = this.db.prepare('SELECT * FROM author_configs WHERE work_id = ? AND request_id = ?').get(workId, request.requestId) as { revision: number; expected_revision: number; document: string } | undefined
      if (prior) {
        const receipt = validateStoreValue(authorConfigReceiptSchema, { workId, revision: prior.revision, requestId: request.requestId, document: parseJson(prior.document) }, 'stored')
        if (prior.expected_revision !== request.expectedRevision || JSON.stringify(receipt.document) !== JSON.stringify(request.document)) throw new KnownError('version-conflict', 'request identity already used')
        return receipt
      }
      const current = this.getAuthorConfig(workId)?.revision ?? 0
      if (current !== request.expectedRevision) throw new KnownError('version-conflict', 'configuration revision changed')
      const receipt = validateStoreValue(authorConfigReceiptSchema, { workId, revision: current + 1, requestId: request.requestId, document: request.document }, 'input')
      this.db.prepare('INSERT INTO author_configs (work_id, revision, request_id, expected_revision, document) VALUES (?, ?, ?, ?, ?)').run(workId, receipt.revision, request.requestId, request.expectedRevision, JSON.stringify(receipt.document))
      return receipt
    })
  }

  getAuthorConfigReceipt(workId: string, requestId: string): AuthorConfigReceipt | undefined {
    return this.read(() => {
      this.requireWork(workId)
      const row = this.db.prepare('SELECT * FROM author_configs WHERE work_id = ? AND request_id = ?').get(workId, requestId) as { revision: number; document: string } | undefined
      return row && validateStoreValue(authorConfigReceiptSchema, { workId, requestId, revision: row.revision, document: parseJson(row.document) }, 'stored')
    })
  }

  listAgentFiles(workId: string): AgentFile[] {
    return this.read(() => {
      this.requireWork(workId)
      const rows = this.db.prepare('SELECT * FROM agent_files WHERE work_id = ? ORDER BY rowid').all(workId) as { id: string; work_id: string; metadata: string }[]
      return rows.map(row => {
        const file = validateStoreValue(agentFileSchema, parseJson(row.metadata), 'stored')
        if (file.id !== row.id || file.workId !== row.work_id) throw new StoreContractError('invalid-stored-data')
        return file
      })
    })
  }

  putAgentFile(input: AgentFile): AgentFile {
    const file = validateStoreValue(agentFileSchema, input, 'input')
    return this.write(() => {
      this.requireWork(file.workId)
      const existing = this.db.prepare('SELECT * FROM agent_files WHERE id = ?').get(file.id) as { metadata: string } | undefined
      if (existing) {
        const prior = validateStoreValue(agentFileSchema, parseJson(existing.metadata), 'stored')
        if (prior.workId !== file.workId || prior.sha256 !== file.sha256 || prior.kind !== file.kind) throw new KnownError('version-conflict', 'file request identity already used')
        return prior
      }
      if (this.listAgentFiles(file.workId).length >= authorConfigLimits.filesPerWork) throw new KnownError('config-invalid', 'file library limit exceeded')
      this.db.prepare('INSERT INTO agent_files (id, work_id, metadata) VALUES (?, ?, ?)').run(file.id, file.workId, JSON.stringify(file))
      return file
    })
  }
}
