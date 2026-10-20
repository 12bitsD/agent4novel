import type {
  Artifact, ArtifactKind, HumanStatus, JsonValue, Work, WorkDetail, WorkSummary, WorkCreateRequest,
  SettingExtensionActionRequest, SettingExtensionProposeRequest,
  SettingExtensionReceipt, SettingExtensionResource,
} from '@agent4novel/contracts'

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
  humanStatus?: HumanStatus
  preconditions?: readonly ArtifactPrecondition[]
  inputs?: Artifact['inputs']
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

export type SaveArtifactInput = FinalizeArtifactInput & { expectedHumanStatus: HumanStatus }

export type SettingExtensionStore = {
  proposeSettingExtension(workId: string, request: SettingExtensionProposeRequest): SettingExtensionReceipt
  approveSettingExtension(workId: string, request: SettingExtensionActionRequest): SettingExtensionReceipt
  cancelSettingExtension(workId: string, request: SettingExtensionActionRequest): SettingExtensionReceipt
  getSettingExtension(workId: string, requestId: string): SettingExtensionResource
}

export interface WorkStore extends SettingExtensionStore {
  // Inputs and returned snapshots must not expose mutable store-owned references.
  createWork(input: WorkCreateRequest): Work
  listWorks(): WorkSummary[]
  getWork(id: string): WorkDetail | undefined
  // Read one immutable historical version without exposing other history.
  getArtifactVersion(workId: string, kind: ArtifactKind, chapter: number | undefined, artifactId: string, version: number): Artifact | undefined
  appendArtifact(
    workId: string,
    kind: ArtifactKind,
    content: JsonValue,
    opts?: AppendOptions,
  ): Artifact
  // Atomically replace a pending head's content and approve it without a new version.
  finalizeArtifact(input: FinalizeArtifactInput): Artifact
  // Atomically append edited content with a fresh identity/version, preserving the matched head's status.
  saveArtifact(input: SaveArtifactInput): Artifact
  setStatus(
    workId: string,
    kind: ArtifactKind,
    status: HumanStatus,
    opts?: { chapter?: number; preconditions?: readonly ArtifactPrecondition[] },
  ): void
}
