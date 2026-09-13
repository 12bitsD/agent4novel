import { describe, expect, it } from 'vitest'
import { generationParametersSchema, stepExperimentRequestSchema, stepExperimentResponseSchema } from '../src/index.js'

describe('step experiment contracts', () => {
  it('accepts supported sampling endpoints without inserting runtime defaults', () => {
    expect(generationParametersSchema.parse({})).toEqual({})
    expect(generationParametersSchema.parse({ thinking: 'enabled', temperature: 0, topP: 1 }))
      .toEqual({ thinking: 'enabled', temperature: 0, topP: 1 })
    expect(generationParametersSchema.safeParse({ thinking: 'disabled', temperature: 1, topP: 0.001 }).success).toBe(true)
  })

  it.each([
    { thinking: 'on' }, { temperature: '0.9' }, { temperature: -0.1 }, { temperature: 1.1 },
    { temperature: NaN }, { temperature: Infinity }, { topP: 0 }, { topP: 1.1 },
    { topP: NaN }, { topP: Infinity }, { topK: 40 }, { top_k: 40 },
  ])('rejects unsupported generation controls: %j', config => {
    expect(generationParametersSchema.safeParse(config).success).toBe(false)
    expect(stepExperimentRequestSchema.safeParse({ stepId: 'caption', input: { seed: '' }, config }).success).toBe(false)
  })

  it('limits overrides to the explicit request surface', () => {
    const request = { stepId: 'caption', input: { seed: 'synthetic seed' } }
    expect(stepExperimentRequestSchema.parse(request)).toEqual(request)
    for (const invalid of [
      { ...request, config: { systemPrompt: 'ignored' } },
      { ...request, config: { apiKey: 'synthetic-key' } },
      { ...request, input: { ...request.input, workId: 'existing-work' } },
      { ...request, outputMode: 'raw' },
      { ...request, systemPrompt: '   ' },
      { ...request, systemPrompt: 'x'.repeat(100001) },
    ]) expect(stepExperimentRequestSchema.safeParse(invalid).success).toBe(false)
  })

  it('requires chapter one for Beat and forbids chapters on other nodes', () => {
    expect(stepExperimentRequestSchema.safeParse({ stepId: 'beat', input: { seed: '', chapter: 1 } }).success).toBe(true)
    for (const [stepId, chapter] of [['beat', undefined], ['beat', 2], ['caption', 1]]) {
      expect(stepExperimentRequestSchema.safeParse({ stepId, input: { seed: '', chapter } }).success).toBe(false)
    }
  })

  it('keeps failure diagnostics separate from generated content and raw provider output', () => {
    const base = { runId: 'experiment-test', stepId: 'caption', executionMode: 'live', model: 'longcat:LongCat-2.0', telemetry: [] }
    const success = { ...base, kind: 'succeeded', content: { summary: 'validated content' } }
    const failure = { ...base, kind: 'failed', code: 'llm-invalid-output', retryable: true }
    expect(stepExperimentResponseSchema.safeParse(success).success).toBe(true)
    expect(stepExperimentResponseSchema.safeParse(failure).success).toBe(true)
    for (const invalid of [{ ...success, raw: 'provider text' }, { ...failure, content: {} }, { ...failure, message: 'provider error' }]) {
      expect(stepExperimentResponseSchema.safeParse(invalid).success).toBe(false)
    }
  })
})
