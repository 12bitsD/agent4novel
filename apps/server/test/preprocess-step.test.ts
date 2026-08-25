import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runStep } from '@agent4novel/contracts'

// vi.mock 提升：mock 引用必须经 vi.hoisted 定义
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  languageModel: vi.fn(() => 'mock-model'),
}))
vi.mock('ai', () => ({ generateText: mocks.generateText }))
vi.mock('../src/steps/llm.js', () => ({
  registry: { languageModel: mocks.languageModel },
  defaultModelId: 'deepseek:deepseek-chat',
}))

import { createPreprocessStep } from '../src/steps/preprocess-step.js'

const step = createPreprocessStep()
const baseInput = { workId: 'w1', seed: '一个都市异能校园故事' }
const validNormalizeJson = JSON.stringify({
  inputStage: '脑洞',
  hooks: ['h'],
  synopsis: ['s'],
  setting: [{ title: 't', content: 'c' }],
  outline: [],
})

beforeEach(() => {
  mocks.generateText.mockReset()
  mocks.languageModel.mockClear()
})

describe('preprocess RealStep', () => {
  it('questions phase returns parsed questions', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"questions":["q1","q2"]}' })
    const out = await runStep(step, { ...baseInput, phase: 'questions' }, {})
    expect(out.content).toEqual({ questions: ['q1', 'q2'] })
  })

  it('strips markdown code fences around the JSON', async () => {
    mocks.generateText.mockResolvedValue({ text: '```json\n{"questions":["q"]}\n```' })
    const out = await runStep(step, { ...baseInput, phase: 'questions' }, {})
    expect(out.content).toEqual({ questions: ['q'] })
  })

  it('normalize phase returns validated PreprocessContent', async () => {
    mocks.generateText.mockResolvedValue({ text: validNormalizeJson })
    const out = await runStep(
      step,
      { ...baseInput, phase: 'normalize', answers: [{ question: 'q', answer: 'a' }] },
      {},
    )
    expect(out.content).toMatchObject({ inputStage: '脑洞', hooks: ['h'] })
  })

  it('defaults phase to normalize when omitted', async () => {
    mocks.generateText.mockResolvedValue({ text: validNormalizeJson })
    const out = await runStep(step, baseInput, {})
    expect(out.content).toMatchObject({ inputStage: '脑洞' })
  })

  it('rejects invalid JSON from the model', async () => {
    mocks.generateText.mockResolvedValue({ text: 'not json at all' })
    await expect(runStep(step, { ...baseInput, phase: 'questions' }, {})).rejects.toThrow()
  })

  it('rejects schema-mismatched JSON from the model', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"questions":"nope"}' })
    await expect(runStep(step, { ...baseInput, phase: 'questions' }, {})).rejects.toThrow()
  })

  it('assembles system (skill file) + prompt (seed, answers) into generateText', async () => {
    mocks.generateText.mockResolvedValue({ text: validNormalizeJson })
    await runStep(
      step,
      { ...baseInput, phase: 'normalize', answers: [{ question: '主角是谁？', answer: '林澈' }] },
      {},
    )
    const arg = mocks.generateText.mock.calls[0]![0] as {
      model: unknown
      system: string
      prompt: string
    }
    expect(arg.model).toBe('mock-model')
    expect(arg.system).toContain('预处理')
    expect(arg.prompt).toContain('一个都市异能校园故事')
    expect(arg.prompt).toContain('林澈')
  })

  it('config.model overrides the default model id', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"questions":[]}' })
    await runStep(step, { ...baseInput, phase: 'questions' }, { model: 'deepseek:other' })
    expect(mocks.languageModel).toHaveBeenCalledWith('deepseek:other')
  })
})
