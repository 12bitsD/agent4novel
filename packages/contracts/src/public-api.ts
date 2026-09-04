import { z } from 'zod'
import { artifactKinds, workViewEnvelopeSchema } from './artifacts.js'
import { settingArtifactSchema } from './setting.js'
import { llmTelemetrySchema } from './telemetry.js'

export const workViewSchema = workViewEnvelopeSchema.superRefine((work, ctx) => {
  const heads = new Set<string>()
  work.artifacts.forEach((artifact, i) => {
    if (artifact.workId !== work.id) {
      ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'workId'], message: '产物必须属于当前作品' })
    }
    const address = `${artifact.kind}:${artifact.chapter ?? ''}`
    if (heads.has(address)) {
      ctx.addIssue({ code: 'custom', path: ['artifacts', i], message: '同一产物地址只能有一个当前版本' })
    }
    heads.add(address)
    if (artifact.kind !== 'setting') return
    const parsed = settingArtifactSchema.safeParse(artifact)
    if (!parsed.success) for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue, path: ['artifacts', i, ...issue.path] })
    }
  })
})

export const gateRefSchema = z.object({ kind: z.enum(artifactKinds), chapter: z.number().int().positive().optional() }).strict()
export const pipelineStateSchema = z.object({
  workId: z.string(), stage: z.enum(['ready', 'blocked', 'awaiting-approval', 'complete']),
  nextStepId: z.string().nullable(), pendingGate: gateRefSchema.optional(),
}).strict()
const advanced = z.object({ kind: z.literal('advanced'), stepId: z.string(), state: pipelineStateSchema }).strict()
const awaiting = z.object({ kind: z.literal('awaiting-approval'), state: pipelineStateSchema }).strict()
const complete = z.object({ kind: z.literal('complete'), state: pipelineStateSchema }).strict()
const failed = z.object({
  kind: z.literal('failed'), stepId: z.string(), code: z.string(), retryable: z.boolean(),
  attemptId: z.string().optional(), state: pipelineStateSchema,
}).strict()
export const advanceOutcomeSchema = z.discriminatedUnion('kind', [advanced, awaiting, complete, failed])
const telemetry = { telemetry: z.array(llmTelemetrySchema) }
export const advanceOutcomeDtoSchema = z.discriminatedUnion('kind', [
  advanced.extend(telemetry), awaiting.extend(telemetry), complete.extend(telemetry), failed.extend(telemetry),
])
export type GateRef = z.infer<typeof gateRefSchema>
export type PipelineStage = z.infer<typeof pipelineStateSchema>['stage']
export type PipelineState = z.infer<typeof pipelineStateSchema>
export type AdvanceOutcome = z.infer<typeof advanceOutcomeSchema>
export type AdvanceOutcomeDto = z.infer<typeof advanceOutcomeDtoSchema>
