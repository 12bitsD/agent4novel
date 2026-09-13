import { randomUUID } from 'node:crypto'
import { runStep, stepExperimentRequestSchema } from '@agent4novel/contracts'
import type { ArtifactKind, StepExperimentRequest, StepExperimentResponse } from '@agent4novel/contracts'
import { ZodError } from 'zod'
import { KnownError } from '../errors.js'
import { consumeGuards } from '../pipeline/consume-guards.js'
import { createCaptionStep } from './caption-step.js'
import { createCreativeStep } from './creative-step.js'
import { createOutlineStep } from './outline-step.js'
import { createSettingStep } from './setting-step.js'
import { createBeatStep } from './beat-step.js'
import { modelRuntime } from './llm.js'
import { telemetryFor } from './telemetry.js'

const factories = { caption: createCaptionStep, creative: createCreativeStep, outline: createOutlineStep, setting: createSettingStep, beat: createBeatStep }
const consumes: Record<StepExperimentRequest['stepId'], ArtifactKind[]> = {
  caption: [], creative: ['caption'], outline: ['creative'], setting: ['caption', 'creative', 'outline'], beat: ['outline', 'setting'],
}

// Runs exactly one production step against supplied content. No work store or pipeline is created.
export async function runIsolatedStep(request: StepExperimentRequest): Promise<StepExperimentResponse> {
  const runId = `experiment-${randomUUID()}`
  const selectedModel = request.config?.model ?? modelRuntime.defaultModelId
  const model = /^(deepseek:[a-zA-Z0-9_.-]{1,96}|longcat:LongCat-2\.0)$/.test(selectedModel) ? selectedModel : 'unrecognized-model'
  const base = { runId, stepId: request.stepId, executionMode: 'live' as const, model }
  try {
    const parsed = stepExperimentRequestSchema.parse(request)
    const step = factories[parsed.stepId]({ systemPrompt: parsed.systemPrompt })
    const input = step.inputSchema.parse({ ...parsed.input, upstream: parsed.input.upstream ?? {}, workId: runId })
    const upstream = parsed.input.upstream ?? {}
    for (const kind of consumes[parsed.stepId]) consumeGuards[kind]?.(upstream[kind]!)
    if (modelRuntime.mode !== 'live') throw new KnownError('llm-unavailable', 'Live model configuration required')
    const result = await runStep(step, input, parsed.config ?? {})
    return { ...base, kind: 'succeeded', content: result.content, telemetry: telemetryFor(runId) }
  } catch (error) {
    return { ...base, kind: 'failed', code: error instanceof ZodError ? 'invalid-input' : error instanceof KnownError ? error.code : 'step-failed',
      retryable: error instanceof KnownError && error.retryable, telemetry: telemetryFor(runId) }
  }
}
