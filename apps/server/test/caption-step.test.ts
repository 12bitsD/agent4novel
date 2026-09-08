import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runStep } from '@agent4novel/contracts'

// vi.mock 提升:mock 引用必须经 vi.hoisted 定义
const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  languageModel: vi.fn(() => 'mock-model'),
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({
  modelRuntime: {
    defaultModelId: 'deepseek:deepseek-chat',
    requestTimeoutMs: 120_000,
    languageModel: mocks.languageModel,
  },
}))

import { createCaptionStep } from '../src/steps/caption-step.js'
import { telemetryFor, resetTelemetry, withRequest } from '../src/steps/telemetry.js'

const step = createCaptionStep()
const baseInput = { workId: 'w1', seed: '一个都市异能校园故事', upstream: {} }

const validCaption = {
  inputStage: '脑洞',
  summary: '一句话概括。',
  elements: [{ kind: '人物', content: '主角' }],
  gaps: [],
}

beforeEach(() => {
  mocks.generateObject.mockReset()
  mocks.languageModel.mockClear()
})

describe('caption RealStep', () => {
  it('keeps synthetic secrets out of shared error logs and telemetry while returning useful safe diagnostics', async () => {
    const marker = 'SYNTHETIC_PRIVATE_MARKER'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    resetTelemetry()
    mocks.generateObject.mockRejectedValue(Object.assign(new Error(marker), {
      name: 'AI_NoObjectGeneratedError', text: marker, cause: new Error(marker), finishReason: 'stop', usage: { outputTokens: 20 },
    }))
    try {
      await expect(withRequest('11111111-1111-4111-8111-111111111111', false, () => runStep(step, baseInput, {}))).rejects.toMatchObject({ code: 'llm-invalid-output' })
      expect(JSON.stringify(log.mock.calls)).not.toContain(marker)
      expect(JSON.stringify(telemetryFor('w1'))).not.toContain(marker)
      expect(telemetryFor('w1')).toMatchObject([{ error: 'output-schema', requestId: '11111111-1111-4111-8111-111111111111' }])
      mocks.generateObject.mockRejectedValue(new Error(marker))
      await expect(runStep(step, baseInput, {})).rejects.toMatchObject({ message: 'llm request unavailable' })
    } finally { log.mockRestore() }
  })
  it('returns schema-valid caption content', async () => {
    mocks.generateObject.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    const out = await runStep(step, baseInput, {})
    expect(out.content).toEqual(validCaption)
  })

  it('assembles system(skill)+ prompt(seed) into generateObject with timeout', async () => {
    mocks.generateObject.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    await runStep(step, baseInput, {})
    const arg = mocks.generateObject.mock.calls[0]![0] as {
      model: unknown
      system: string
      prompt: string
      abortSignal: unknown
    }
    expect(arg.model).toBe('mock-model')
    expect(arg.system).toContain('提炼')
    expect(arg.prompt).toContain('一个都市异能校园故事')
    expect(arg.abortSignal).toBeDefined()
  })

  it('config.model overrides the default model id', async () => {
    mocks.generateObject.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    await runStep(step, baseInput, { model: 'deepseek:other' })
    expect(mocks.languageModel).toHaveBeenCalledWith('deepseek:other')
  })

  it('truncates oversized seed at the prompt assembly point', async () => {
    mocks.generateObject.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    const big = 'x'.repeat(150_000)
    await runStep(step, { ...baseInput, seed: big }, {})
    const arg = mocks.generateObject.mock.calls[0]![0] as { prompt: string }
    expect(arg.prompt.length).toBeLessThan(110_000)
  })

  it('schema-invalid model output → llm-invalid-output (retryable)', async () => {
    const err = Object.assign(new Error('no object'), { name: 'NoObjectGeneratedError' })
    mocks.generateObject.mockRejectedValue(err)
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({
      code: 'llm-invalid-output',
      retryable: true,
    })
  })

  it('timeout → llm-timeout', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    mocks.generateObject.mockRejectedValue(err)
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({ code: 'llm-timeout' })
  })

  it('network failure → llm-unavailable', async () => {
    mocks.generateObject.mockRejectedValue(new Error('fetch failed'))
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({ code: 'llm-unavailable' })
  })
})
