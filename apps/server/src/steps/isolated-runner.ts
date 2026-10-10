import { randomUUID } from 'node:crypto'
import { runStep, stepExperimentRequestSchema } from '@agent4novel/contracts'
import type { ArtifactKind, StepExperimentRequest, StepExperimentResponse, StepExperimentRecording } from '@agent4novel/contracts'
import { ZodError } from 'zod'
import { KnownError } from '../errors.js'
import { consumeGuards } from '../pipeline/consume-guards.js'
import { createCaptionStep } from './caption-step.js'
import { createCreativeStep } from './creative-step.js'
import { createOutlineStep } from './outline-step.js'
import { createSettingStep } from './setting-step.js'
import { createProseStep } from './prose-step.js'
import { createBeatStep } from './beat-step.js'
import { modelRuntime } from './llm.js'
import { telemetryFor } from './telemetry.js'
import { StepRecordError, StepRecorder, withStepRecorder } from './step-record.js'

const factories = { caption: createCaptionStep, creative: createCreativeStep, outline: createOutlineStep, setting: createSettingStep, beat: createBeatStep, prose: createProseStep }
const consumes: Record<StepExperimentRequest['stepId'], ArtifactKind[]> = {
  caption: [], creative: ['caption'], outline: ['creative'], setting: ['caption', 'creative', 'outline'], beat: ['outline', 'setting'], prose: ['beat', 'setting'],
}

// Runs exactly one production step against supplied content. No work store or pipeline is created.
export async function runIsolatedStep(request: StepExperimentRequest): Promise<StepExperimentResponse> {
  const runId = `experiment-${randomUUID()}`
  const selectedModel = request.config?.model ?? modelRuntime.defaultModelId
  const model = /^(deepseek:[a-zA-Z0-9_.-]{1,96}|kimi:[a-zA-Z0-9_.-]{1,96}|longcat:LongCat-2\.0)$/.test(selectedModel) ? selectedModel : 'unrecognized-model'
  const base = { runId, stepId: request.stepId, executionMode: 'live' as const, model }
  let recorder: StepRecorder | undefined
  let parsed: StepExperimentRequest | undefined
  try {
    const validated = stepExperimentRequestSchema.parse(request)
    parsed = validated
    if (validated.record) recorder = await StepRecorder.start({ request: validated.record, input: validated.input, runId, stepId: validated.stepId, model })
    const execute = async () => {
      const step = factories[validated.stepId]({ systemPrompt: validated.systemPrompt })
      const input = step.inputSchema.parse({ ...validated.input, upstream: validated.input.upstream ?? {}, workId: runId })
      const upstream = validated.input.upstream ?? {}
      for (const kind of consumes[validated.stepId]) consumeGuards[kind]?.(upstream[kind]!)
      if (modelRuntime.mode !== 'live') throw new KnownError('llm-unavailable', 'Live model configuration required')
      return runStep(step, input, validated.config ?? {})
    }
    const result = recorder ? await withStepRecorder(recorder, execute) : await execute()
    const recording = recorder ? await recorder.finish({ status: 'succeeded', content: result.content, code: null, retryable: null, telemetry: telemetryFor(runId) }) : undefined
    return { ...base, kind: 'succeeded', content: result.content, telemetry: telemetryFor(runId), ...(recording ? { recording } : {}) }
  } catch (error) {
    const code = error instanceof ZodError ? 'invalid-input' : error instanceof StepRecordError ? 'recording-failed' : error instanceof KnownError ? error.code : 'step-failed'
    const retryable = error instanceof KnownError && error.retryable
    let recording: StepExperimentRecording | undefined
    if (recorder) recording = await recorder.finish({ status: 'failed', content: null, code, retryable, telemetry: telemetryFor(runId) })
    else if (parsed?.record) recording = { status: 'failed', dir: parsed.record.dir, error: error instanceof StepRecordError ? error.reason : 'recording-not-prepared' }
    return { ...base, kind: 'failed', code, retryable, telemetry: telemetryFor(runId), ...(recording ? { recording } : {}) }
  }
}
