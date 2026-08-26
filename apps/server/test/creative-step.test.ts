import { describe, it, expect, vi, beforeEach } from 'vitest'
import { creativeContentSchema, runStep } from '@agent4novel/contracts'

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  languageModel: vi.fn(() => 'mock-model'),
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({
  registry: { languageModel: mocks.languageModel },
  defaultModelId: 'deepseek:deepseek-chat',
}))

import { createCreativeStep } from '../src/steps/creative-step.js'

const step = createCreativeStep()

const caption = {
  inputStage: '脑洞' as const,
  summary: '提炼。',
  elements: [],
  gaps: [],
}
const baseInput = { workId: 'w-9', seed: '一个悬疑小镇故事', upstream: { caption } }

function llmPack(title: string) {
  return {
    title,
    hook: '钩子',
    tags: ['悬疑'],
    synopsis: '概要。',
    characters: [],
    setting: [],
    payoffs: [],
    outline: [],
  }
}

beforeEach(() => {
  mocks.generateObject.mockReset()
  mocks.languageModel.mockClear()
})

describe('creative RealStep', () => {
  it('returns N directions with server-injected directionId(默认 2)', async () => {
    mocks.generateObject.mockResolvedValue({
      object: { directions: [llmPack('A'), llmPack('B')] },
      usage: {},
      finishReason: 'stop',
    })
    const out = await runStep(step, baseInput, {})
    const content = creativeContentSchema.parse(out.content)
    expect(content.directions).toHaveLength(2)
    expect(content.directions.map((d) => d.directionId)).toEqual(['w-9-dir-1', 'w-9-dir-2'])
  })

  it('honors config.directionCount(1/3)并写入 prompt', async () => {
    mocks.generateObject.mockResolvedValue({
      object: { directions: [llmPack('A'), llmPack('B'), llmPack('C')] },
      usage: {},
      finishReason: 'stop',
    })
    const out = await runStep(step, baseInput, { directionCount: 3 })
    expect(creativeContentSchema.parse(out.content).directions).toHaveLength(3)
    const arg = mocks.generateObject.mock.calls[0]![0] as { prompt: string }
    expect(arg.prompt).toContain('3 个')
  })

  it('prompt 同时含素材与提炼稿', async () => {
    mocks.generateObject.mockResolvedValue({
      object: { directions: [llmPack('A'), llmPack('B')] },
      usage: {},
      finishReason: 'stop',
    })
    await runStep(step, baseInput, {})
    const arg = mocks.generateObject.mock.calls[0]![0] as { prompt: string; system: string }
    expect(arg.prompt).toContain('一个悬疑小镇故事')
    expect(arg.prompt).toContain('提炼。')
    expect(arg.system).toContain('创意')
  })

  it('模型给出数量与 directionCount 不符 → llm-invalid-output(严格校验)', async () => {
    mocks.generateObject.mockResolvedValue({
      object: { directions: [llmPack('A')] },
      usage: {},
      finishReason: 'stop',
    })
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({
      code: 'llm-invalid-output',
      retryable: true,
    })
  })

  it('directionCount=1:恰好 1 个方向(仍需后续显式 select)', async () => {
    mocks.generateObject.mockResolvedValue({
      object: { directions: [llmPack('A')] },
      usage: {},
      finishReason: 'stop',
    })
    const out = await runStep(step, baseInput, { directionCount: 1 })
    const content = creativeContentSchema.parse(out.content)
    expect(content.directions).toHaveLength(1)
    expect(content.directions[0]!.directionId).toBe('w-9-dir-1')
  })
})
