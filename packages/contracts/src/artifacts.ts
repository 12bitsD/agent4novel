import { z } from 'zod'
import type { AgentConfig } from './step.js'

export const artifactKinds = ['caption', 'creative', 'outline', 'setting', 'beat', 'prose'] as const
export type ArtifactKind = (typeof artifactKinds)[number]

export const humanStatuses = ['pending', 'approved'] as const
export type HumanStatus = (typeof humanStatuses)[number]

export const perChapterKinds: ArtifactKind[] = ['beat', 'prose']
export const perWorkKinds: ArtifactKind[] = ['caption', 'creative', 'outline', 'setting']

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

// 读模型(#3c):GET /works/:id 同快照附带,web 只渲染不重建状态机
export const workflowStates = [
  'ready-to-generate',
  'generating',
  'awaiting-selection',
  'selected',
  'failed',
] as const
export type WorkflowState = (typeof workflowStates)[number]

export type WorkView = WorkDetail & {
  workflowState: WorkflowState
  allowedActions: string[]
}

// 统一错误形(#3c 决策 16):code 机器读,retryable 供 web 决定重试,attemptId 串联日志
export type ApiError = {
  code: string
  retryable: boolean
  attemptId?: string
  message: string
}
