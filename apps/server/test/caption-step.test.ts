import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runStep } from '@agent4novel/contracts'
import { NextloopError } from '../src/steps/nextloop-error.js'

// vi.mock 提升:mock 引用必须经 vi.hoisted 定义
const mocks = vi.hoisted(() => ({
  runNextloop: vi.fn(),
  languageModel: vi.fn(() => 'mock-model'),
}))
vi.mock('../src/steps/nextloop-client.js', () => ({ runNextloop: mocks.runNextloop }))
vi.mock('../src/steps/llm.js', () => ({
  modelRuntime: {
    defaultModelId: 'kimi:kimi-k2.8-highspeed',
    requestTimeoutMs: 120_000, generationSettings: () => ({ parameters: {}, options: {} }),
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
  mocks.runNextloop.mockReset()
  mocks.languageModel.mockClear()
})

describe('caption RealStep', () => {
  it('keeps synthetic secrets out of shared error logs and telemetry while returning useful safe diagnostics', async () => {
    const marker = 'SYNTHETIC_PRIVATE_MARKER'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    resetTelemetry()
    mocks.runNextloop.mockRejectedValue(Object.assign(new Error(marker), {
      name: 'AI_NoObjectGeneratedError', text: marker, cause: new Error(marker), finishReason: 'stop', usage: { outputTokens: 20 },
    }))
    try {
      await expect(withRequest('11111111-1111-4111-8111-111111111111', false, () => runStep(step, baseInput, {}))).rejects.toMatchObject({ code: 'llm-invalid-output' })
      expect(JSON.stringify(log.mock.calls)).not.toContain(marker)
      expect(JSON.stringify(telemetryFor('w1'))).not.toContain(marker)
      expect(telemetryFor('w1')).toMatchObject([{ error: 'output-schema', requestId: '11111111-1111-4111-8111-111111111111' }])
      mocks.runNextloop.mockRejectedValue(new Error(marker))
      await expect(runStep(step, baseInput, {})).rejects.toMatchObject({ message: 'llm request unavailable' })
    } finally { log.mockRestore() }
  })
  it('returns schema-valid caption content', async () => {
    mocks.runNextloop.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    const out = await runStep(step, baseInput, {})
    expect(out.content).toEqual(validCaption)
  })

  it('assembles system(skill)+ prompt(seed) into runNextloop with timeout', async () => {
    mocks.runNextloop.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    await runStep(step, baseInput, {})
    const arg = mocks.runNextloop.mock.calls[0]![0] as {
      model: unknown
      system: string
      prompt: string
      timeoutMs: number
      attemptId: string
    }
    expect(arg.model).toBe('mock-model')
    expect(arg.system).toContain('你是故事开发编辑。')
    expect(arg.prompt).toContain('一个都市异能校园故事')
    expect(arg.timeoutMs).toBe(120_000)
    expect(arg.attemptId).toBeDefined()
  })

  it('config.model overrides the default model id', async () => {
    mocks.runNextloop.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    await runStep(step, baseInput, { model: 'kimi:other' })
    expect(mocks.languageModel).toHaveBeenCalledWith('kimi:other')
  })

  it('truncates oversized seed at the prompt assembly point', async () => {
    mocks.runNextloop.mockResolvedValue({ object: validCaption, usage: {}, finishReason: 'stop' })
    const big = 'x'.repeat(150_000)
    await runStep(step, { ...baseInput, seed: big }, {})
    const arg = mocks.runNextloop.mock.calls[0]![0] as { prompt: string }
    expect(arg.prompt.length).toBeLessThan(110_000)
  })

  it('schema-invalid model output → llm-invalid-output (retryable)', async () => {
    const err = Object.assign(new Error('no object'), { name: 'NoObjectGeneratedError' })
    mocks.runNextloop.mockRejectedValue(err)
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({
      code: 'llm-invalid-output',
      retryable: true,
    })
  })

  it('Nextloop timeout → llm-timeout with the existing safe message', async () => {
    mocks.runNextloop.mockRejectedValue(new NextloopError('llm-timeout', true))
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({
      code: 'llm-timeout',
      message: 'llm request timed out',
      retryable: true,
    })
  })

  it('preserves the output-truncated telemetry classification', async () => {
    mocks.runNextloop.mockRejectedValue(new NextloopError('llm-invalid-output', true, { outputTokens: 8000 }, 'length'))
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({ code: 'llm-invalid-output' })
    expect(telemetryFor('w1').at(-1)).toMatchObject({ error: 'output-truncated', outputTokens: 8000, finishReason: 'length' })
  })

  it('network failure → llm-unavailable', async () => {
    mocks.runNextloop.mockRejectedValue(new Error('fetch failed'))
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({ code: 'llm-unavailable' })
  })
})
