import { z } from 'zod'
import { jsonValueSchema } from './artifacts.js'
import { agentConfigSchema } from './step.js'
import { seedCharBudget } from './limits.js'
import { proseEditDraftSchema, proseLimits } from './prose.js'
import { beatEditDraftSchema, beatLimits } from './beat.js'
import { llmTelemetrySchema } from './telemetry.js'
import { artifactContentSchemas } from './artifact-content.js'

export const experimentStepIds = ['caption', 'creative', 'outline', 'setting', 'beat', 'prose'] as const
export const stepExperimentRequestSchema = z.object({
  stepId: z.enum(experimentStepIds),
  input: z.object({
    seed: z.string().max(seedCharBudget),
    upstream: z.record(jsonValueSchema).optional(),
    chapter: z.number().int().positive().safe().optional(),
    regeneration: z.union([
      z.object({ content: beatEditDraftSchema, instructions: z.string().max(beatLimits.instructions) }).strict(),
      z.object({ content: proseEditDraftSchema, instructions: z.string().max(proseLimits.instructions) }).strict(),
    ]).optional(),
  }).strict(),
  systemPrompt: z.string().min(1).max(100000).refine(value => value.trim().length > 0).optional(),
  config: agentConfigSchema.pick({ model: true, directionCount: true, thinking: true, temperature: true, topP: true }).strict().optional(),
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
export const stepExperimentResponseSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('succeeded'), content: jsonValueSchema }).strict(),
  base.extend({ kind: z.literal('failed'), code: z.string(), retryable: z.boolean() }).strict(),
]).superRefine((result, ctx) => {
  if (result.kind !== 'succeeded') return
  const parsed = artifactContentSchemas[result.stepId].safeParse(result.content)
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ['content', ...issue.path] })
})
export type StepExperimentResponse = z.infer<typeof stepExperimentResponseSchema>
