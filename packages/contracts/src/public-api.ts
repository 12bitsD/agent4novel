import { z } from 'zod'
import { artifactKinds, perChapterKinds, workViewEnvelopeSchema, apiErrorSchema, validateWorkArtifacts } from './artifacts.js'
import { llmTelemetrySchema } from './telemetry.js'
import { beatCommandObservationSchema, beatInputBudgetSchema, beatCommandErrorSchema } from './beat-command.js'
import { proseCommandObservationSchema, proseInputBudgetSchema, proseCommandErrorSchema } from './prose-command.js'
export const appConfigSchema = z.object({ demo: z.boolean() }).strict()
export type AppConfig = z.infer<typeof appConfigSchema>

export const workViewSchema = workViewEnvelopeSchema.superRefine(validateWorkArtifacts)

export const gateRefSchema = z.object({ kind: z.enum(artifactKinds), chapter: z.number().int().positive().safe().optional() }).strict().superRefine((gate, ctx) => {
  if (perChapterKinds.includes(gate.kind) !== (gate.chapter !== undefined)) ctx.addIssue({ code: 'custom', path: ['chapter'], message: 'chapter 与产物 kind 不匹配' })
})
export const pipelineStateSchema = z.object({
  workId: z.string(), stage: z.enum(['ready', 'blocked', 'awaiting-approval', 'complete']),
  nextStepId: z.string().nullable(), pendingGate: gateRefSchema.optional(),
}).strict()
const advanced = z.object({ kind: z.literal('advanced'), stepId: z.string(), state: pipelineStateSchema, beatCommand: beatCommandObservationSchema.optional(), proseCommand: proseCommandObservationSchema.optional() }).strict()
const awaiting = z.object({ kind: z.literal('awaiting-approval'), state: pipelineStateSchema }).strict()
const complete = z.object({ kind: z.literal('complete'), state: pipelineStateSchema }).strict()
const failed = z.object({
  kind: z.literal('failed'), stepId: z.string(), code: z.string(), retryable: z.boolean(),
  attemptId: z.string().optional(), state: pipelineStateSchema,
  beatCommand: beatCommandObservationSchema.optional(),
  proseCommand: proseCommandObservationSchema.optional(),
  inputBudget: z.union([beatInputBudgetSchema, proseInputBudgetSchema]).optional(),
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

// Command failures preserve their write outcome and diagnostics through generic HTTP clients.
export const httpErrorSchema = z.union([beatCommandErrorSchema, proseCommandErrorSchema, apiErrorSchema])
export type HttpError = z.infer<typeof httpErrorSchema>

// Parse the envelope first; association is a separate check against the submitted target.
export function matchesStartChapterResponse(response: AdvanceOutcomeDto | HttpError, workId: string, chapter: number): boolean {
  if ('state' in response && response.state.workId !== workId) return false
  if ('proseCommand' in response && response.proseCommand !== undefined) return false
  const command = 'command' in response ? response.command : 'beatCommand' in response ? response.beatCommand : undefined
  return command === undefined || (command.operation === 'generate-beat' && (command.kind === 'request-rejected'
    || (command.target.workId === workId && command.target.kind === 'beat' && command.target.chapter === chapter)))
}
