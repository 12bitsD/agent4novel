import type { Artifact, ArtifactKind, HumanStatus, JsonValue, Work, WorkDetail, WorkSummary } from '@agent4novel/contracts'

export type ArtifactPrecondition = {
  kind: ArtifactKind
  chapter?: number
  // null requires no bucket; otherwise all three head fields must match.
  head: null | {
    artifactId: string
    version: number
    humanStatus: HumanStatus
  }
}

export type AppendOptions = {
  chapter?: number
  preconditions?: readonly ArtifactPrecondition[]
}

export type FinalizeArtifactInput = {
  workId: string
  kind: ArtifactKind
  chapter?: number
  expectedArtifactId: string
  expectedHeadVersion: number
  content: JsonValue
  preconditions?: readonly ArtifactPrecondition[]
}

export interface WorkStore {
  // Inputs and returned snapshots must not expose mutable store-owned references.
  createWork(input: { seed: string; title?: string }): Work
  listWorks(): WorkSummary[]
  getWork(id: string): WorkDetail | undefined
  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: AppendOptions,
  ): Artifact
  // Atomically replace a pending head's content and approve it without a new version.
  finalizeArtifact(input: FinalizeArtifactInput): Artifact
  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number },
  ): void
  // 某 bucket 最新版本号(无产物 → undefined);供 expectedHeadVersion 乐观锁比对
  headVersion(workId: string, kind: ArtifactKind, opts?: { chapter?: number }): number | undefined
}
