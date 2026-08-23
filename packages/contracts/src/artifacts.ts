import type { AgentConfig } from './step.js'

export const artifactKinds = ['hook', 'synopsis', 'outline', 'setting', 'beat', 'prose'] as const
export type ArtifactKind = (typeof artifactKinds)[number]

export const humanStatuses = ['pending', 'approved'] as const
export type HumanStatus = (typeof humanStatuses)[number]

export const perChapterKinds: ArtifactKind[] = ['beat', 'prose']
export const perWorkKinds: ArtifactKind[] = ['hook', 'synopsis', 'outline', 'setting']

export type Artifact = {
  id: string
  workId: string
  kind: ArtifactKind
  chapter?: number
  version: number
  content: string
  status: HumanStatus
  createdAt: string
}

export type Work = {
  id: string
  title: string
  seed: string
  config: AgentConfig
  createdAt: string
}

export type WorkSummary = {
  id: string
  title: string
  seedPreview: string
  chapterCount: number
}

export type WorkDetail = Work & { artifacts: Artifact[] }
