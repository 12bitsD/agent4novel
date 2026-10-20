import { emptyAgentConfig, artifactSchema, workSchema, workDetailSchema, workCreateRequestSchema, workListResponseSchema } from '@agent4novel/contracts'
import { randomUUID } from 'node:crypto'
import type {
  Artifact,
  ArtifactKind,
  HumanStatus,
  JsonValue,
  Work,
  WorkDetail,
  WorkSummary,
  WorkCreateRequest,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import { actOnExtension, proposeExtension, extensionReceipt, extensionResource, isValidApprovedExtensionCandidate } from '../setting-extension.js'
import { settingExtensionProposalRecordSchema, type SettingExtensionProposalRecord, type SettingExtensionProposeRequest, type SettingExtensionActionRequest, type SettingExtensionReceipt, type SettingExtensionResource } from '@agent4novel/contracts'
import type { AppendOptions, ArtifactPrecondition, FinalizeArtifactInput, SaveArtifactInput, WorkStore } from './work-store.js'

import { StoreContractError, validateStoreValue } from './validation.js'
import { assertBucketAddress, assertDirectStatusAllowed } from './invariants.js'

type Bucket = { kind: ArtifactKind; chapter?: number; versions: Artifact[] }

export class InMemoryStore implements WorkStore {
  private extensionProposals = new Map<string, SettingExtensionProposalRecord>()
  private works = new Map<string, Work>()
  private buckets = new Map<string, Bucket[]>()
  private nextId(prefix: string): string {
    return `${prefix}-${randomUUID()}`
  }

  private findBucket(workId: string, kind: ArtifactKind, chapter?: number): Bucket | undefined {
    return this.buckets.get(workId)?.find((b) => b.kind === kind && b.chapter === chapter)
  }

  private assertPreconditions(
    workId: string,
    kind: ArtifactKind,
    chapter: number | undefined,
    preconditions: readonly ArtifactPrecondition[] = [],
  ): void {
    for (const condition of preconditions) {
      assertBucketAddress(condition.kind, condition.chapter)
      const bucket = this.findBucket(workId, condition.kind, condition.chapter)
      const head = bucket?.versions.at(-1)
      const matches = condition.head === null
        ? bucket === undefined
        : head?.id === condition.head.artifactId
          && head.version === condition.head.version
          && head.humanStatus === condition.head.humanStatus
      if (!matches) {
        const isTarget = condition.kind === kind && condition.chapter === chapter
        throw new KnownError(
          isTarget ? 'version-conflict' : 'upstream-changed',
          `artifact precondition changed: ${workId}/${condition.kind}`,
        )
      }
    }
  }

  createWork(input: WorkCreateRequest): Work {
    const parsed = validateStoreValue(workCreateRequestSchema, input, 'input')
    const title = parsed.title?.trim() || undefined
    const work: Work = {
      id: this.nextId('work'),
      title: title ?? parsed.seed.slice(0, 20),
      seed: parsed.seed,
      config: structuredClone(emptyAgentConfig),
      createdAt: new Date().toISOString(),
    }
    const snapshot = validateStoreValue(workSchema, work, 'input')
    this.works.set(work.id, work)
    this.buckets.set(work.id, [])
    return snapshot
  }

  listWorks(): WorkSummary[] {
    return validateStoreValue(workListResponseSchema, [...this.works.keys()].map((id) => {
      const w = this.getWork(id)!
      const buckets = this.buckets.get(w.id) ?? []
      const chapterCount = buckets.filter((b) => b.kind === 'prose' && b.versions.at(-1)?.humanStatus === 'approved').length
      return {
        id: w.id,
        title: w.title,
        seedPreview: w.seed.length > 40 ? `${w.seed.slice(0, 40)}…` : w.seed,
        chapterCount,
      }
    }), 'stored')
  }

  getWork(id: string): WorkDetail | undefined {
    const work = this.works.get(id)
    if (!work) return undefined
    const artifacts = (this.buckets.get(id) ?? [])
      .map((b) => b.versions[b.versions.length - 1])
      .filter((a): a is Artifact => a !== undefined)
    return validateStoreValue(workDetailSchema, { ...work, artifacts }, 'stored')
  }

  getArtifactVersion(workId: string, kind: ArtifactKind, chapter: number | undefined, artifactId: string, version: number): Artifact | undefined {
    const artifact = this.findBucket(workId, kind, chapter)?.versions.find(candidate => candidate.id === artifactId && candidate.version === version)
    return artifact === undefined ? undefined : validateStoreValue(artifactSchema, artifact, 'stored')
  }

  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: AppendOptions,
  ): Artifact {
    if (!this.works.has(workId)) throw new KnownError('work-not-found', `work not found: ${workId}`)
    const options = structuredClone(opts)
    const chapter = options?.chapter
    assertBucketAddress(kind, chapter)
    if (options?.humanStatus === 'approved') assertDirectStatusAllowed(kind)
    const storedContent = structuredClone(content)
    this.assertPreconditions(workId, kind, chapter, options?.preconditions)
    const bucket = this.findBucket(workId, kind, chapter)
    const artifact: Artifact = {
      id: this.nextId('artifact'),
      workId,
      kind,
      chapter,
      version: (bucket?.versions.length ?? 0) + 1,
      content: storedContent,
      humanStatus: options?.humanStatus ?? 'pending',
      createdAt: new Date().toISOString(),
      ...(options?.inputs ? { inputs: options.inputs } : {}),
    }
    const snapshot = validateStoreValue(artifactSchema, artifact, 'input')
    const candidate: Bucket = { kind, chapter, versions: [...(bucket?.versions ?? []), artifact] }
    const previous = this.buckets.get(workId)!
    const next = bucket
      ? previous.map((entry) => entry === bucket ? candidate : entry)
      : [...previous, candidate]
    this.buckets.set(workId, next)
    return snapshot
  }

  finalizeArtifact(input: FinalizeArtifactInput): Artifact {
    const request = structuredClone(input)
    const { workId, kind, chapter } = request
    if (!this.works.has(workId)) throw new KnownError('work-not-found', `work not found: ${workId}`)
    assertBucketAddress(kind, chapter)
    const bucket = this.findBucket(workId, kind, chapter)
    const head = bucket?.versions.at(-1)
    if (!bucket || !head || head.id !== request.expectedArtifactId || head.version !== request.expectedHeadVersion) {
      throw new KnownError('version-conflict', `artifact head changed: ${workId}/${kind}`)
    }
    if (head.humanStatus === 'approved') {
      throw new KnownError('artifact-already-approved', `artifact already approved: ${workId}/${kind}`)
    }
    this.assertPreconditions(workId, kind, chapter, request.preconditions)
    const artifact: Artifact = { ...head, content: request.content, humanStatus: 'approved' }
    const snapshot = validateStoreValue(artifactSchema, artifact, 'input')
    const candidate: Bucket = { ...bucket, versions: [...bucket.versions.slice(0, -1), artifact] }
    const next = this.buckets.get(workId)!.map((entry) => entry === bucket ? candidate : entry)
    this.buckets.set(workId, next)
    return snapshot
  }

  saveArtifact(input: SaveArtifactInput): Artifact {
    const request = structuredClone(input)
    const { workId, kind, chapter } = request
    if (!this.works.has(workId)) throw new KnownError('work-not-found', `work not found: ${workId}`)
    assertBucketAddress(kind, chapter)
    const bucket = this.findBucket(workId, kind, chapter)
    const head = bucket?.versions.at(-1)
    if (!bucket || !head || head.id !== request.expectedArtifactId || head.version !== request.expectedHeadVersion || head.humanStatus !== request.expectedHumanStatus) {
      throw new KnownError('version-conflict', `artifact head changed: ${workId}/${kind}`)
    }
    this.assertPreconditions(workId, kind, chapter, request.preconditions)
    const artifact: Artifact = { ...head, id: this.nextId('artifact'), version: head.version + 1, content: request.content, createdAt: new Date().toISOString() }
    const snapshot = validateStoreValue(artifactSchema, artifact, 'input')
    const candidate: Bucket = { ...bucket, versions: [...bucket.versions, artifact] }
    this.buckets.set(workId, this.buckets.get(workId)!.map(entry => entry === bucket ? candidate : entry))
    return snapshot
  }

  private extensionKey(workId: string, requestId: string): string {
    return JSON.stringify([workId, requestId])
  }

  private extensionRecord(workId: string, requestId: string): SettingExtensionProposalRecord | undefined {
    const record = this.extensionProposals.get(this.extensionKey(workId, requestId))
    return record === undefined ? undefined : validateStoreValue(settingExtensionProposalRecordSchema, record, 'stored')
  }

  private validateExtensionCandidate(record: SettingExtensionProposalRecord | undefined): void {
    if (!record || record.status !== 'approved') return
    const candidate = record.candidate === null ? undefined : this.getArtifactVersion(record.workId, 'setting', undefined, record.candidate.artifactId, record.candidate.version)
    if (!isValidApprovedExtensionCandidate(record, candidate)) throw new StoreContractError('invalid-stored-data')
  }

  private requireExtensionWork(workId: string): WorkDetail {
    const work = this.getWork(workId)
    if (!work) throw new KnownError('work-not-found', 'work not found')
    return work
  }

  proposeSettingExtension(workId: string, request: SettingExtensionProposeRequest): SettingExtensionReceipt {
    const work = this.requireExtensionWork(workId)
    const key = this.extensionKey(workId, request.requestId)
    const record = proposeExtension(work, request, this.extensionRecord(workId, request.requestId))
    this.extensionProposals.set(key, structuredClone(record))
    return extensionReceipt(record, 'propose')
  }

  private actSettingExtension(workId: string, request: SettingExtensionActionRequest, operation: 'approve' | 'cancel'): SettingExtensionReceipt {
    const work = this.requireExtensionWork(workId)
    const key = this.extensionKey(workId, request.requestId)
    const plan = actOnExtension(work, request, this.extensionRecord(workId, request.requestId), operation)
    // Prepare both replacement values before the commit. This synchronous section
    // has no callback/yield where another in-memory writer could interleave.
    if (plan.artifact) {
      const bucket = this.findBucket(workId, 'setting')!
      const candidate: Bucket = { ...bucket, versions: [...bucket.versions, structuredClone(plan.artifact)] }
      const next = this.buckets.get(workId)!.map(entry => entry === bucket ? candidate : entry)
      const storedRecord = structuredClone(plan.record)
      this.buckets.set(workId, next)
      this.extensionProposals.set(key, storedRecord)
    } else this.extensionProposals.set(key, structuredClone(plan.record))
    return extensionReceipt(plan.record, operation)
  }

  approveSettingExtension(workId: string, request: SettingExtensionActionRequest): SettingExtensionReceipt {
    return this.actSettingExtension(workId, request, 'approve')
  }

  cancelSettingExtension(workId: string, request: SettingExtensionActionRequest): SettingExtensionReceipt {
    return this.actSettingExtension(workId, request, 'cancel')
  }

  getSettingExtension(workId: string, requestId: string): SettingExtensionResource {
    const work = this.requireExtensionWork(workId)
    const record = this.extensionRecord(workId, requestId)
    this.validateExtensionCandidate(record)
    return extensionResource(work, requestId, record)
  }

  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number; preconditions?: readonly ArtifactPrecondition[] },
  ): void {
    assertDirectStatusAllowed(kind)
    assertBucketAddress(kind, opts?.chapter)
    this.assertPreconditions(workId, kind, opts?.chapter, opts?.preconditions)
    const bucket = this.findBucket(workId, kind, opts?.chapter)
    if (!bucket || bucket.versions.length === 0) {
      throw new KnownError(
        'artifact-not-found',
        `artifact not found: ${workId}/${kind}${opts?.chapter !== undefined ? `#${opts.chapter}` : ''}`,
      )
    }
    const index = bucket.versions.length - 1
    const candidate = validateStoreValue(artifactSchema, { ...bucket.versions[index], humanStatus: status }, 'input')
    bucket.versions[index] = candidate
  }
}
