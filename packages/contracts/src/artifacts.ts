import { z } from 'zod'
import { agentConfigSchema } from './step.js'

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

export const artifactEnvelopeSchema = z.object({
  id: z.string().min(1),
  workId: z.string().min(1),
  kind: z.enum(artifactKinds),
  chapter: z.number().int().positive().safe().optional(),
  version: z.number().int().positive().safe(),
  content: jsonValueSchema,
  humanStatus: z.enum(humanStatuses),
  createdAt: z.string().min(1),
}).strict()

export const artifactSchema = artifactEnvelopeSchema.superRefine((artifact, ctx) => {
  if (perChapterKinds.includes(artifact.kind) !== (artifact.chapter !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['chapter'], message: 'chapter 与产物 kind 不匹配' })
  }
})

export type Artifact = z.infer<typeof artifactSchema>
export const workSchema = z.object({
  id: z.string().min(1), title: z.string(), seed: z.string(), config: agentConfigSchema,
  createdAt: z.string().min(1),
}).strict()
export type Work = z.infer<typeof workSchema>

export type WorkSummary = {
  id: string
  title: string
  seedPreview: string
  chapterCount: number
}

export const workDetailSchema = workSchema.extend({ artifacts: z.array(artifactSchema) })
export type WorkDetail = z.infer<typeof workDetailSchema>

// 读模型(#3c / #4):GET /works/:id 同快照附带,web 只渲染不重建状态机。
// 注意:web 另有一个本地瞬态 'generating'(advance 请求在途),不属于本契约。
// #4:随 outline 关卡加入,按 pendingGate.kind 分派;'selected' 在 3 项 definition 下不可达,已移除。
export const workflowStates = [
  'ready-to-generate',
  'awaiting-selection',
  'awaiting-outline-review',
  'outline-approved',
  'awaiting-setting-review',
  'setting-approved',
  'failed',
] as const
export type WorkflowState = (typeof workflowStates)[number]

export const workViewEnvelopeSchema = workDetailSchema.extend({
  workflowState: z.enum(workflowStates), allowedActions: z.array(z.string()), nextStepId: z.string().nullable(),
})
export type WorkView = z.infer<typeof workViewEnvelopeSchema>

// 统一错误形(#3c 决策 16):code 机器读,retryable 供 web 决定重试,attemptId 串联日志
export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])), code: z.string(), message: z.string(),
}).strict()
export type ValidationIssue = z.infer<typeof validationIssueSchema>
export const apiErrorSchema = z.object({
  code: z.string().min(1), retryable: z.boolean(), attemptId: z.string().optional(), message: z.string(),
  issues: z.array(validationIssueSchema).optional(),
}).strict()
export type ApiError = z.infer<typeof apiErrorSchema>
export type SettingApiError = ApiError
