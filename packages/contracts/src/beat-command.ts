import { z } from 'zod'
import { apiErrorSchema, workflowStates } from './artifacts.js'
import { chapterRegenerationBindingSchema } from './artifact-envelope.js'
import { beatArtifactSchema } from './beat.js'
import { llmTelemetrySchema } from './telemetry.js'
import { beatVariantComparisonSchema } from './beat-variant.js'

export const beatOperationSchema = z.enum(['generate-beat', 'regenerate-beat', 'approve-beat'])
export const beatHeadSchema = z.object({ artifactId: z.string().min(1), version: z.number().int().positive().safe() }).strict()
export const beatTargetSchema = z.object({ workId: z.string().min(1), kind: z.literal('beat'), chapter: z.number().int().positive().safe() }).strict()
const common = {
  requestId: z.string().uuid(), operation: beatOperationSchema,
  executionMode: z.enum(['demo', 'live']), latencyMs: z.number().nonnegative().finite(),
}
const execution = z.object({
  ...common, kind: z.literal('execution-result'), target: beatTargetSchema, expectedHead: beatHeadSchema.nullable(),
  regeneration: chapterRegenerationBindingSchema.optional(),
  writeOutcome: z.enum(['committed', 'not-committed', 'unknown']),
  failureStage: z.enum(['request', 'precondition', 'input', 'model', 'output', 'commit', 'response']).optional(),
  attemptIds: z.array(z.string().min(1)).max(1000),
  resultHead: beatHeadSchema.extend({ humanStatus: z.enum(['pending', 'approved']) }).optional(),
}).strict()
const rejected = z.object({
  ...common, kind: z.literal('request-rejected'), writeOutcome: z.literal('not-committed'),
  regeneration: chapterRegenerationBindingSchema.optional(),
  failureStage: z.literal('request'), attemptIds: z.array(z.string()).length(0),
}).strict()
export const beatCommandObservationSchema = z.discriminatedUnion('kind', [execution, rejected]).superRefine((v, ctx) => {
  if (v.kind !== 'execution-result') return
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (v.regeneration && v.operation !== 'regenerate-beat') invalid('章节重生绑定只能用于章纲再生')
  if (v.regeneration && (!v.expectedHead || v.regeneration.expectedBeat.artifactId !== v.expectedHead.artifactId || v.regeneration.expectedBeat.version !== v.expectedHead.version)) invalid('章节重生章纲目标不匹配')
  if ((v.operation === 'generate-beat') !== (v.expectedHead === null)) invalid('基线与命令不匹配')
  if (v.operation === 'approve-beat' && v.attemptIds.length) invalid('人工通过不得包含模型尝试')
  if (new Set(v.attemptIds).size !== v.attemptIds.length) invalid('重复尝试')
  if (v.writeOutcome === 'committed') {
    if (!v.resultHead || v.failureStage) invalid('提交成功必须提供结果且无失败阶段')
    if (v.resultHead) {
      const approve = v.operation === 'approve-beat'
      if (v.resultHead.humanStatus !== (approve ? 'approved' : 'pending')) invalid('结果状态不匹配')
      if (v.resultHead.version !== (approve ? v.expectedHead?.version : (v.expectedHead?.version ?? 0) + 1)) invalid('结果版本不匹配')
      if (v.expectedHead && ((v.resultHead.artifactId === v.expectedHead.artifactId) !== approve)) invalid('结果身份不匹配')
    }
  } else if (!v.failureStage || v.resultHead) invalid('失败不得虚构结果')
})
export type BeatOperation = z.infer<typeof beatOperationSchema>
export type BeatCommandObservation = z.infer<typeof beatCommandObservationSchema>
export type BeatExecutionObservation = Extract<BeatCommandObservation, { kind: 'execution-result' }>
export const beatWorkflowSchema = z.object({
  workflowState: z.enum(workflowStates), nextStepId: z.string().nullable(), allowedActions: z.array(z.string()),
}).strict()
const beatCommandResponseObjectSchema = z.object({
  artifact: beatArtifactSchema, comparison: beatVariantComparisonSchema.optional(), command: beatCommandObservationSchema, workflow: beatWorkflowSchema, telemetry: z.array(llmTelemetrySchema),
}).strict()
const beatCommandResponseEffects = beatCommandResponseObjectSchema.superRefine((v, ctx) => {
  const command = v.command
  if (command.kind !== 'execution-result' || command.writeOutcome !== 'committed'
    || command.target.chapter !== v.artifact.chapter || command.target.workId !== v.artifact.workId || command.resultHead?.artifactId !== v.artifact.id
    || command.resultHead.version !== v.artifact.version || command.resultHead.humanStatus !== v.artifact.humanStatus) {
    ctx.addIssue({ code: 'custom', message: '成功结果与命令观察不一致' })
  }
})
// Keep the object schema's public shape for callers that need to discover the
// optional comparison while retaining the cross-field response invariant.
export const beatCommandResponseSchema = Object.assign(beatCommandResponseEffects, { shape: beatCommandResponseObjectSchema.shape })
export const beatInputBudgetSchema = z.object({
  limit: z.number().int().positive(), actualLength: z.number().int().nonnegative(),
  systemChars: z.number().int().nonnegative(), outlineChars: z.number().int().nonnegative(), settingChars: z.number().int().nonnegative(),
  previousChapterChars: z.number().int().nonnegative().optional(),
  draftChars: z.number().int().nonnegative(), instructionsChars: z.number().int().nonnegative(),
}).strict()
export type BeatInputBudget = z.infer<typeof beatInputBudgetSchema>
export const beatCommandErrorSchema = apiErrorSchema.extend({
  command: beatCommandObservationSchema, telemetry: z.array(llmTelemetrySchema).optional(), workflow: beatWorkflowSchema.optional(),
  inputBudget: beatInputBudgetSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.command.writeOutcome === 'committed'
    || (v.command.kind === 'request-rejected' && !['bad-json', 'invalid-input', 'payload-too-large', 'unsupported-chapter'].includes(v.code))) {
    ctx.addIssue({ code: 'custom', message: '错误与命令观察不一致' })
  }
})
export type BeatCommandResponse = z.infer<typeof beatCommandResponseSchema>
export type BeatCommandFailure = z.infer<typeof beatCommandErrorSchema>
