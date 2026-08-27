import { describe, it, expect, vi, beforeEach } from 'vitest'
import { outlineContentSchema, runStep } from '@agent4novel/contracts'

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  languageModel: vi.fn(() => 'mock-model'),
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({
  registry: { languageModel: mocks.languageModel },
  defaultModelId: 'deepseek:deepseek-chat',
}))

import { createOutlineStep } from '../src/steps/outline-step.js'

const step = createOutlineStep()

// 选定单方向的创意稿(消费守卫保证恰好 1 方向)
const creative = {
  directions: [
    {
      directionId: 'w-9-dir-1',
      title: '预言外卖员',
      hook: '他送的不是外卖,是明天的新闻。',
      tags: ['都市', '悬疑'],
      synopsis: '外卖员发现自己的订单会出现在未来新闻里……',
      characters: [],
      setting: [],
      payoffs: [],
      outline: [],
    },
  ],
}
const baseInput = { workId: 'w-9', seed: '一个悬疑小镇故事', upstream: { creative } }

// LLM 面向形态:无 arcId/segmentId
function llmArc(title: string, segCount = 2) {
  return {
    title,
    conflict: '核心冲突',
    development: '冲突发展',
    resolution: '矛盾解决与收束局势',
    segments: Array.from({ length: segCount }, (_, j) => ({
      title: `剧情点${j + 1}`,
      summary: '本段发生什么',
      outcome: '本段结束后的局势',
    })),
  }
}
const llmOutline = { arcs: [llmArc('开局'), llmArc('升级'), llmArc('收束')] }

beforeEach(() => {
  mocks.generateObject.mockReset()
  mocks.languageModel.mockClear()
})

describe('outline RealStep', () => {
  it('returns arcs with server-injected arcId/segmentId', async () => {
    mocks.generateObject.mockResolvedValue({ object: llmOutline, usage: {}, finishReason: 'stop' })
    const out = await runStep(step, baseInput, {})
    const content = outlineContentSchema.parse(out.content)
    expect(content.arcs).toHaveLength(3)
    expect(content.arcs.map((a) => a.arcId)).toEqual(['w-9-arc-1', 'w-9-arc-2', 'w-9-arc-3'])
    expect(content.arcs[0]!.segments.map((s) => s.segmentId)).toEqual([
      'w-9-arc-1-seg-1',
      'w-9-arc-1-seg-2',
    ])
  })

  it('prompt 同时含素材与选定方向包', async () => {
    mocks.generateObject.mockResolvedValue({ object: llmOutline, usage: {}, finishReason: 'stop' })
    await runStep(step, baseInput, {})
    const arg = mocks.generateObject.mock.calls[0]![0] as { prompt: string; system: string }
    expect(arg.prompt).toContain('一个悬疑小镇故事')
    expect(arg.prompt).toContain('预言外卖员')
    expect(arg.system).toContain('大纲')
  })

  it('模型输出未过 schema(SDK NoObjectGeneratedError)→ llm-invalid-output', async () => {
    // 真实路径:generateObject 内部按 outlineLlmOutputSchema 校验失败抛 AI_NoObjectGeneratedError
    // (v7 实际错误名带 AI_ 前缀,真机实测确认),llm-call 按 err.name 映射;mock 不走 SDK 校验,这里直接模拟
    const err = new Error('schema validation failed')
    err.name = 'AI_NoObjectGeneratedError'
    mocks.generateObject.mockRejectedValue(err)
    await expect(runStep(step, baseInput, {})).rejects.toMatchObject({
      code: 'llm-invalid-output',
      retryable: true,
    })
  })
})
