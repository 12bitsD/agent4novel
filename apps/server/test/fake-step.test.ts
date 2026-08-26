import { describe, it, expect } from 'vitest'
import { captionContentSchema, creativeContentSchema, runStep } from '@agent4novel/contracts'
import { createFakeCaptionStep, createFakeCreativeStep } from '../src/steps/fake-step.js'

const caption = {
  inputStage: '脑洞' as const,
  summary: '提炼。',
  elements: [],
  gaps: [],
}

describe('fake caption step(演示模式)', () => {
  it('returns schema-valid caption derived from the seed', async () => {
    const out = await runStep(
      createFakeCaptionStep(),
      { workId: 'w', seed: '一个悬疑小镇故事', upstream: {} },
      {},
    )
    const parsed = captionContentSchema.parse(out.content)
    expect(parsed.summary).toContain('悬疑小镇')
  })
})

describe('fake creative step(演示模式)', () => {
  const input = { workId: 'w-1', seed: '一个悬疑小镇故事', upstream: { caption } }

  it('默认出 2 个方向,带 directionId,schema 有效', async () => {
    const out = await runStep(createFakeCreativeStep(), input, {})
    const parsed = creativeContentSchema.parse(out.content)
    expect(parsed.directions).toHaveLength(2)
    expect(parsed.directions.map((d) => d.directionId)).toEqual(['w-1-dir-1', 'w-1-dir-2'])
  })

  it('按 config.directionCount 出 N 包(1/3)', async () => {
    const one = await runStep(createFakeCreativeStep(), input, { directionCount: 1 })
    expect(creativeContentSchema.parse(one.content).directions).toHaveLength(1)
    const three = await runStep(createFakeCreativeStep(), input, { directionCount: 3 })
    expect(creativeContentSchema.parse(three.content).directions).toHaveLength(3)
  })
})
