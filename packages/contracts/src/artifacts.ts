import { z } from 'zod'
import { agentConfigSchema } from './step.js'

import { artifactEnvelopeSchema, humanStatuses, perChapterKinds } from './artifact-envelope.js'
import { artifactContentSchemaFor } from './artifact-content.js'
import { workSummarySchema } from './work-requests.js'
export * from './artifact-envelope.js'

export const artifactSchema = artifactEnvelopeSchema.superRefine((artifact, ctx) => {
  const parsed = artifactContentSchemaFor(artifact.kind, artifact.humanStatus).safeParse(artifact.content)
  if (!parsed.success) for (const issue of parsed.error.issues) {
    ctx.addIssue({ ...issue, path: ['content', ...issue.path] })
  }
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

export type WorkSummary = z.infer<typeof workSummarySchema>

const workDetailEnvelopeSchema = workSchema.extend({ artifacts: z.array(artifactSchema) })
export function validateWorkArtifacts(work: z.infer<typeof workDetailEnvelopeSchema>, ctx: z.RefinementCtx): void {
  const heads = new Set<string>()
  work.artifacts.forEach((artifact, i) => {
    if (artifact.workId !== work.id) ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'workId'], message: '产物必须属于当前作品' })
    const address = `${artifact.kind}:${artifact.chapter ?? ''}`
    if (heads.has(address)) ctx.addIssue({ code: 'custom', path: ['artifacts', i], message: '同一产物地址只能有一个当前版本' })
    heads.add(address)
  })
}
export const workDetailSchema = workDetailEnvelopeSchema.superRefine(validateWorkArtifacts)
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
  'awaiting-beat-review',
  'beat-approved',
  'awaiting-prose-review',
  'prose-approved',
  'failed',
] as const
export type WorkflowState = (typeof workflowStates)[number]

export const chapterSummarySchema = z.object({
  chapter: z.number().int().positive().safe(), title: z.string(),
  beatStatus: z.enum(humanStatuses).nullable(), proseStatus: z.enum(humanStatuses).nullable(),
  allowedActions: z.array(z.string()), needsContinuityReview: z.boolean(),
}).strict()
export type ChapterSummary = z.infer<typeof chapterSummarySchema>
export const startChapterRequestSchema = z.object({
  chapter: z.number().int().min(2).safe(), expectedPreviousProseId: z.string().min(1).max(128),
  expectedPreviousProseVersion: z.number().int().positive().safe(),
}).strict()
export type StartChapterRequest = z.infer<typeof startChapterRequestSchema>

export const workViewEnvelopeSchema = workDetailEnvelopeSchema.extend({
  currentChapter: z.number().int().positive().safe().default(1), chapters: z.array(chapterSummarySchema).default([]),
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
