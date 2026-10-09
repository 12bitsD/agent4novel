import { z } from 'zod'
import { jsonValueSchema } from './artifacts.js'
import { agentConfigSchema } from './step.js'
import { seedCharBudget } from './limits.js'
import { proseEditDraftSchema, proseLimits } from './prose.js'
import { beatEditDraftSchema, beatLimits } from './beat.js'
import { llmTelemetrySchema } from './telemetry.js'
import { artifactContentSchemas } from './artifact-content.js'

export const experimentStepIds = ['caption', 'creative', 'outline', 'setting', 'beat', 'prose'] as const
const stepExperimentRecordSourcesSchema = z.object({
  input: z.enum(['input-file', 'seed-file']),
  inputPath: z.string().nullable(),
  systemPromptPath: z.string().nullable(),
  configPath: z.string().nullable(),
}).strict()
const stepExperimentRecordVersionSchema = z.object({
  gitCommit: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
}).strict()
export const stepExperimentRecordRequestSchema = z.object({
  dir: z.string().min(1).max(4096),
  sources: stepExperimentRecordSourcesSchema,
  version: stepExperimentRecordVersionSchema,
}).strict()
export type StepExperimentRecordRequest = z.infer<typeof stepExperimentRecordRequestSchema>

export const stepExperimentInputSchema = z.object({
  seed: z.string().max(seedCharBudget),
  upstream: z.record(jsonValueSchema).optional(),
  chapter: z.number().int().positive().safe().optional(),
  regeneration: z.union([
    z.object({ content: beatEditDraftSchema, instructions: z.string().max(beatLimits.instructions) }).strict(),
    z.object({ content: proseEditDraftSchema, instructions: z.string().max(proseLimits.instructions) }).strict(),
  ]).optional(),
}).strict()

export const stepExperimentRequestSchema = z.object({
  stepId: z.enum(experimentStepIds),
  input: stepExperimentInputSchema,
  systemPrompt: z.string().min(1).max(100000).refine(value => value.trim().length > 0).optional(),
  config: agentConfigSchema.pick({ model: true, directionCount: true, thinking: true, temperature: true, topP: true }).strict().optional(),
  record: stepExperimentRecordRequestSchema.optional(),
}).strict().superRefine((request, ctx) => {
  const chapterStep = request.stepId === 'beat' || request.stepId === 'prose'
  if (chapterStep ? request.input.chapter === undefined : request.input.chapter !== undefined || request.input.regeneration !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['input', 'chapter'], message: 'chapter and regeneration require a supported chapter step' })
  }
  if (chapterStep && request.input.regeneration) {
    const content = request.stepId === 'beat' ? beatEditDraftSchema : proseEditDraftSchema
    if (!content.safeParse(request.input.regeneration.content).success) {
      ctx.addIssue({ code: 'custom', path: ['input', 'regeneration', 'content'], message: 'regeneration content must match the selected step' })
    }
  }
})
export type StepExperimentRequest = z.infer<typeof stepExperimentRequestSchema>
const base = z.object({ runId: z.string(), stepId: z.enum(experimentStepIds), executionMode: z.literal('live'), model: z.string(), telemetry: z.array(llmTelemetrySchema) })
const nullableGenerationSchema = z.object({
  thinking: z.enum(['enabled', 'disabled']).nullable(),
  temperature: z.number().nullable(),
  topP: z.number().nullable(),
}).strict()
export const stepExperimentRecordEffectiveConfigSchema = z.object({
  model: z.string().nullable(),
  directionCount: z.number().int().min(1).max(3).nullable(),
  thinking: z.enum(['enabled', 'disabled']).nullable(),
  temperature: z.number().nullable(),
  topP: z.number().nullable(),
}).strict()
export type StepExperimentRecordEffectiveConfig = z.infer<typeof stepExperimentRecordEffectiveConfigSchema>
export const stepExperimentRecordInputSchema = z.object({
  formatVersion: z.literal(1),
  input: stepExperimentInputSchema,
  sources: stepExperimentRecordSourcesSchema,
}).strict()
export const stepExperimentRecordInvocationSchema = z.object({
  formatVersion: z.literal(1),
  captured: z.boolean(),
  capturedAt: z.string().nullable(),
  system: z.string().nullable(),
  prompt: z.string().nullable(),
  model: z.string().nullable(),
  attemptId: z.string().nullable(),
  effectiveConfig: stepExperimentRecordEffectiveConfigSchema.nullable(),
  generation: nullableGenerationSchema.nullable(),
  sdkOptions: z.object({
    temperature: z.number().nullable(),
    topP: z.number().nullable(),
    providerOptions: jsonValueSchema.nullable(),
  }).strict().nullable(),
  maxOutputTokens: z.number().nullable(),
  maxRetries: z.number().nullable(),
  requestTimeoutMs: z.number().nullable(),
}).strict()
export const stepExperimentRecordResultSchema = z.object({
  formatVersion: z.literal(1),
  status: z.enum(['succeeded', 'failed', 'unknown']),
  content: jsonValueSchema.nullable(),
  diagnostic: z.object({
    code: z.string().nullable(),
    retryable: z.boolean().nullable(),
    error: z.string().nullable(),
    telemetry: z.array(llmTelemetrySchema),
  }).strict(),
}).strict()
export const stepExperimentRecordMetaSchema = z.object({
  formatVersion: z.literal(1),
  complete: z.boolean(),
  status: z.enum(['in-progress', 'complete', 'incomplete']),
  runId: z.string().nullable(),
  stepId: z.enum(experimentStepIds).nullable(),
  executionMode: z.literal('live').nullable(),
  model: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  gitCommit: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
  sources: stepExperimentRecordSourcesSchema.nullable(),
  files: z.object({ input: z.literal('input.json'), invocation: z.literal('invocation.json'), result: z.literal('result.json'), meta: z.literal('meta.json') }).strict(),
}).strict()
export const stepExperimentRecordingSchema = z.object({
  status: z.enum(['complete', 'incomplete', 'failed']),
  dir: z.string(),
  error: z.string().nullable(),
}).strict()
export type StepExperimentRecording = z.infer<typeof stepExperimentRecordingSchema>
export const stepExperimentResponseSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('succeeded'), content: jsonValueSchema, recording: stepExperimentRecordingSchema.optional() }).strict(),
  base.extend({ kind: z.literal('failed'), code: z.string(), retryable: z.boolean(), recording: stepExperimentRecordingSchema.optional() }).strict(),
]).superRefine((result, ctx) => {
  if (result.kind !== 'succeeded') return
  const parsed = artifactContentSchemas[result.stepId].safeParse(result.content)
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ['content', ...issue.path] })
})
export type StepExperimentResponse = z.infer<typeof stepExperimentResponseSchema>
