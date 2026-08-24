import { z } from 'zod'
import type { AgentConfig } from './step.js'

export const artifactKinds = ['preprocess', 'outline', 'setting', 'beat', 'prose'] as const
export type ArtifactKind = (typeof artifactKinds)[number]

export const humanStatuses = ['pending', 'approved'] as const
export type HumanStatus = (typeof humanStatuses)[number]

export const perChapterKinds: ArtifactKind[] = ['beat', 'prose']
export const perWorkKinds: ArtifactKind[] = ['preprocess', 'outline', 'setting']

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)]),
)

export type Artifact = {
  id: string
  workId: string
  kind: ArtifactKind
  chapter?: number
  version: number
  content: JsonValue
  humanStatus: HumanStatus
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
