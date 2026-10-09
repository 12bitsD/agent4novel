import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runStep } from '@agent4novel/contracts'

const mocks = vi.hoisted(() => ({ generateObject: vi.fn(), languageModel: vi.fn(() => 'creative-canary-model') }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({
  modelRuntime: {
    defaultModelId: 'deepseek:deepseek-chat', requestTimeoutMs: 120_000,
    generationSettings: () => ({ parameters: {}, options: {} }), languageModel: mocks.languageModel,
  },
}))

import { createCreativeStep } from '../src/steps/creative-step.js'

const pack = (title: string) => ({ title, hook: 'hook', tags: ['canary'], synopsis: 'synopsis', characters: [], setting: [], payoffs: [], outline: [] })
const caption = { inputStage: '脑洞' as const, summary: 'REAL-CAPTION-CANARY', elements: [], gaps: [] }

describe('creative regeneration production-step acceptance', () => {
  beforeEach(() => mocks.generateObject.mockReset())

  it('E2 captures the real SDK prompt with seed, caption, saved package, and exact author instruction', async () => {
    mocks.generateObject.mockResolvedValue({ object: { directions: [pack('new-A'), pack('new-B')] }, usage: {}, finishReason: 'stop' })
    await runStep(createCreativeStep(), {
      workId: 'creative-canary-work', seed: 'REAL-SEED-CANARY', upstream: { caption },
      regeneration: { content: { directions: [{ directionId: 'old-direction', ...pack('OLD-PACKAGE-CANARY') }] }, instructions: 'REAL-INSTRUCTION-CANARY' },
    }, {})
    const call = mocks.generateObject.mock.calls[0]![0] as { system: string; prompt: string }
    expect(call.system).toContain('创意')
    for (const value of ['REAL-SEED-CANARY', 'REAL-CAPTION-CANARY', 'OLD-PACKAGE-CANARY', 'REAL-INSTRUCTION-CANARY']) expect(call.prompt).toContain(value)
    expect(mocks.languageModel).toHaveBeenCalledWith('deepseek:deepseek-chat')
  })
})
