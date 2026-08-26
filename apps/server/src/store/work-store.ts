import type { Artifact, ArtifactKind, HumanStatus, JsonValue, Work, WorkDetail, WorkSummary } from '@agent4novel/contracts'

export interface WorkStore {
  createWork(input: { seed: string; title?: string }): Work
  listWorks(): WorkSummary[]
  getWork(id: string): WorkDetail | undefined
  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: { chapter?: number },
  ): Artifact
  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number },
  ): void
  // 某 bucket 最新版本号(无产物 → undefined);供 expectedHeadVersion 乐观锁比对
  headVersion(workId: string, kind: ArtifactKind, opts?: { chapter?: number }): number | undefined
}
