import type { Artifact, ArtifactKind, HumanStatus, Work, WorkDetail, WorkSummary } from '@agent4novel/contracts'

export interface WorkStore {
  createWork(input: { seed: string; title?: string }): Work
  listWorks(): WorkSummary[]
  getWork(id: string): WorkDetail | undefined
  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: string,
    opts?: { chapter?: number },
  ): Artifact
  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number },
  ): void
}
