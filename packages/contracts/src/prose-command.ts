import { z } from 'zod'
import { apiErrorSchema, workflowStates } from './artifacts.js'
import { proseArtifactSchema, proseContentSchema } from './prose.js'
import { llmTelemetrySchema } from './telemetry.js'

export const proseOperationSchema = z.enum(['generate-prose', 'regenerate-prose', 'approve-prose', 'save-prose'])
export const proseHeadSchema = z.object({ artifactId: z.string().min(1), version: z.number().int().positive().safe(), humanStatus: z.enum(['pending', 'approved']).optional() }).strict()
export const proseTargetSchema = z.object({ workId: z.string().min(1), kind: z.literal('prose'), chapter: z.number().int().positive().safe() }).strict()
const common = {
  requestId: z.string().uuid(), operation: proseOperationSchema,
  executionMode: z.enum(['demo', 'live']), latencyMs: z.number().nonnegative().finite(),
}
const execution = z.object({
  ...common, kind: z.literal('execution-result'), target: proseTargetSchema, expectedHead: proseHeadSchema.nullable(),
  writeOutcome: z.enum(['committed', 'not-committed', 'unknown']),
  failureStage: z.enum(['request', 'precondition', 'input', 'model', 'output', 'commit', 'response']).optional(),
  attemptIds: z.array(z.string().min(1)).max(1000),
  resultHead: proseHeadSchema.extend({ humanStatus: z.enum(['pending', 'approved']) }).optional(),
}).strict()
const rejected = z.object({
  ...common, kind: z.literal('request-rejected'), writeOutcome: z.literal('not-committed'),
  failureStage: z.literal('request'), attemptIds: z.array(z.string()).length(0),
}).strict()
export const proseCommandObservationSchema = z.discriminatedUnion('kind', [execution, rejected]).superRefine((v, ctx) => {
  if (v.kind !== 'execution-result') return
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message })
  if ((v.operation === 'generate-prose') !== (v.expectedHead === null)) invalid('基线与命令不匹配')
  if ((v.operation === 'approve-prose' || v.operation === 'save-prose') && v.attemptIds.length) invalid('人工写入不得包含模型尝试')
  if ((v.operation === 'save-prose') !== (v.expectedHead?.humanStatus !== undefined)) invalid('保存必须绑定基线审批状态')
  if (new Set(v.attemptIds).size !== v.attemptIds.length) invalid('重复尝试')
  if (v.writeOutcome === 'committed') {
    if (!v.resultHead || v.failureStage) invalid('提交成功必须提供结果且无失败阶段')
    if (v.resultHead) {
      const approve = v.operation === 'approve-prose'
      const status = v.operation === 'save-prose' ? v.expectedHead?.humanStatus : approve ? 'approved' : 'pending'
      if (v.resultHead.humanStatus !== status) invalid('结果状态不匹配')
      if (v.resultHead.version !== (approve ? v.expectedHead?.version : (v.expectedHead?.version ?? 0) + 1)) invalid('结果版本不匹配')
      if (v.expectedHead && ((v.resultHead.artifactId === v.expectedHead.artifactId) !== approve)) invalid('结果身份不匹配')
    }
  } else if (!v.failureStage || v.resultHead) invalid('失败不得虚构结果')
})
export type ProseOperation = z.infer<typeof proseOperationSchema>
export type ProseCommandObservation = z.infer<typeof proseCommandObservationSchema>
export type ProseExecutionObservation = Extract<ProseCommandObservation, { kind: 'execution-result' }>
export const proseWorkflowSchema = z.object({
  workflowState: z.enum(workflowStates), nextStepId: z.string().nullable(), allowedActions: z.array(z.string()),
}).strict()
export const proseCommandResponseSchema = z.object({
  artifact: proseArtifactSchema, command: proseCommandObservationSchema, workflow: proseWorkflowSchema, telemetry: z.array(llmTelemetrySchema),
}).strict().superRefine((v, ctx) => {
  const command = v.command
  if (command.kind !== 'execution-result' || command.writeOutcome !== 'committed'
    || command.target.chapter !== v.artifact.chapter || command.target.workId !== v.artifact.workId || command.resultHead?.artifactId !== v.artifact.id
    || command.resultHead.version !== v.artifact.version || command.resultHead.humanStatus !== v.artifact.humanStatus) {
    ctx.addIssue({ code: 'custom', message: '成功结果与命令观察不一致' })
  }
  if (command.operation !== 'save-prose' && !proseContentSchema.safeParse(v.artifact.content).success) {
    ctx.addIssue({ code: 'custom', path: ['artifact', 'content'], message: '生成或通过的正文不能为空' })
  }
})
export const proseInputBudgetSchema = z.object({
  limit: z.number().int().positive(), actualLength: z.number().int().nonnegative(),
  systemChars: z.number().int().nonnegative(), beatChars: z.number().int().nonnegative(), settingChars: z.number().int().nonnegative(),
  previousChapterChars: z.number().int().nonnegative().optional(),
  draftChars: z.number().int().nonnegative(), instructionsChars: z.number().int().nonnegative(),
}).strict()
export type ProseInputBudget = z.infer<typeof proseInputBudgetSchema>
export const proseCommandErrorSchema = apiErrorSchema.extend({
  command: proseCommandObservationSchema, telemetry: z.array(llmTelemetrySchema).optional(), workflow: proseWorkflowSchema.optional(),
  inputBudget: proseInputBudgetSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.command.writeOutcome === 'committed'
    || (v.command.kind === 'request-rejected' && !['bad-json', 'invalid-input', 'payload-too-large', 'unsupported-chapter'].includes(v.code))) {
    ctx.addIssue({ code: 'custom', message: '错误与命令观察不一致' })
  }
})
export type ProseCommandResponse = z.infer<typeof proseCommandResponseSchema>
export type ProseCommandFailure = z.infer<typeof proseCommandErrorSchema>
