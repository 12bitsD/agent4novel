import { emptyAgentConfig, perChapterKinds, perWorkKinds } from '@agent4novel/contracts'
import type {
  Artifact,
  ArtifactKind,
  HumanStatus,
  JsonValue,
  Work,
  WorkDetail,
  WorkSummary,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { AppendOptions, ArtifactPrecondition, FinalizeArtifactInput, WorkStore } from './work-store.js'

type Bucket = { kind: ArtifactKind; chapter?: number; versions: Artifact[] }

function assertBucketAddress(kind: ArtifactKind, chapter?: number): void {
  if (perChapterKinds.includes(kind) && chapter === undefined) {
    throw new Error(`kind "${kind}" requires a chapter`)
  }
  if (perWorkKinds.includes(kind) && chapter !== undefined) {
    throw new Error(`kind "${kind}" must not have a chapter`)
  }
}

export class InMemoryStore implements WorkStore {
  private works = new Map<string, Work>()
  private buckets = new Map<string, Bucket[]>()
  private seq = 0

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
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

  createWork(input: { seed: string; title?: string }): Work {
    const title = input.title?.trim() || undefined
    const work: Work = {
      id: this.nextId('work'),
      title: title ?? input.seed.slice(0, 20),
      seed: input.seed,
      config: structuredClone(emptyAgentConfig),
      createdAt: new Date().toISOString(),
    }
    const snapshot = structuredClone(work)
    this.works.set(work.id, work)
    this.buckets.set(work.id, [])
    return snapshot
  }

  listWorks(): WorkSummary[] {
    return [...this.works.values()].map((w) => {
      const buckets = this.buckets.get(w.id) ?? []
      const chapterCount = buckets.filter((b) => b.kind === 'prose').length
      return {
        id: w.id,
        title: w.title,
        seedPreview: w.seed.length > 40 ? `${w.seed.slice(0, 40)}…` : w.seed,
        chapterCount,
      }
    })
  }

  getWork(id: string): WorkDetail | undefined {
    const work = this.works.get(id)
    if (!work) return undefined
    const artifacts = (this.buckets.get(id) ?? [])
      .map((b) => b.versions[b.versions.length - 1])
      .filter((a): a is Artifact => a !== undefined)
    return structuredClone({ ...work, artifacts })
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
      humanStatus: 'pending',
      createdAt: new Date().toISOString(),
    }
    const snapshot = structuredClone(artifact)
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
    const snapshot = structuredClone(artifact)
    const candidate: Bucket = { ...bucket, versions: [...bucket.versions.slice(0, -1), artifact] }
    const next = this.buckets.get(workId)!.map((entry) => entry === bucket ? candidate : entry)
    this.buckets.set(workId, next)
    return snapshot
  }

  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number },
  ): void {
    if (kind === 'setting') {
      throw new KnownError('setting-approval-required', 'setting requires the dedicated finalization command')
    }
    const bucket = this.findBucket(workId, kind, opts?.chapter)
    if (!bucket || bucket.versions.length === 0) {
      throw new KnownError(
        'artifact-not-found',
        `artifact not found: ${workId}/${kind}${opts?.chapter !== undefined ? `#${opts.chapter}` : ''}`,
      )
    }
    bucket.versions[bucket.versions.length - 1].humanStatus = status
  }

  headVersion(workId: string, kind: ArtifactKind, opts?: { chapter?: number }): number | undefined {
    const bucket = this.findBucket(workId, kind, opts?.chapter)
    return bucket && bucket.versions.length > 0
      ? bucket.versions[bucket.versions.length - 1].version
      : undefined
  }
}
