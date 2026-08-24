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
import type { WorkStore } from './work-store.js'

type Bucket = { kind: ArtifactKind; chapter?: number; versions: Artifact[] }

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

  createWork(input: { seed: string; title?: string }): Work {
    const work: Work = {
      id: this.nextId('work'),
      title: input.title ?? input.seed.slice(0, 20),
      seed: input.seed,
      config: { ...emptyAgentConfig },
      createdAt: new Date().toISOString(),
    }
    this.works.set(work.id, work)
    this.buckets.set(work.id, [])
    return work
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
    return { ...work, artifacts }
  }

  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: { chapter?: number },
  ): Artifact {
    if (!this.works.has(workId)) throw new Error(`work not found: ${workId}`)
    const chapter = opts?.chapter
    if (perChapterKinds.includes(kind) && chapter === undefined) {
      throw new Error(`kind "${kind}" requires a chapter`)
    }
    if (perWorkKinds.includes(kind) && chapter !== undefined) {
      throw new Error(`kind "${kind}" must not have a chapter`)
    }
    let bucket = this.findBucket(workId, kind, chapter)
    if (!bucket) {
      bucket = { kind, chapter, versions: [] }
      this.buckets.get(workId)!.push(bucket)
    }
    const artifact: Artifact = {
      id: this.nextId('artifact'),
      workId,
      kind,
      chapter,
      version: bucket.versions.length + 1,
      content,
      humanStatus: 'pending',
      createdAt: new Date().toISOString(),
    }
    bucket.versions.push(artifact)
    return artifact
  }

  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number },
  ): void {
    const bucket = this.findBucket(workId, kind, opts?.chapter)
    if (!bucket || bucket.versions.length === 0) {
      throw new Error(
        `artifact not found: ${workId}/${kind}${opts?.chapter !== undefined ? `#${opts.chapter}` : ''}`,
      )
    }
    bucket.versions[bucket.versions.length - 1].humanStatus = status
  }
}
