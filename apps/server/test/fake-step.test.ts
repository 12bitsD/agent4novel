import { describe, it, expect } from 'vitest'
import { preprocessContentSchema, runStep } from '@agent4novel/contracts'
import { createFakePreprocessStep } from '../src/steps/fake-step.js'

describe('fake preprocess step（演示模式）', () => {
  it('questions phase returns fixed questions', async () => {
    const out = await runStep(
      createFakePreprocessStep(),
      { workId: 'w', seed: 's', phase: 'questions' },
      {},
    )
    const content = out.content as { questions: string[] }
    expect(content.questions.length).toBeGreaterThan(0)
  })

  it('normalize phase returns schema-valid content derived from the seed', async () => {
    const out = await runStep(
      createFakePreprocessStep(),
      { workId: 'w', seed: '一个悬疑小镇故事', phase: 'normalize' },
      {},
    )
    const parsed = preprocessContentSchema.parse(out.content)
    expect(parsed.hooks[0]).toContain('悬疑小镇')
  })

  it('normalize phase without answers still works（interview=false 直出）', async () => {
    const out = await runStep(createFakePreprocessStep(), { workId: 'w', seed: 'x' }, {})
    expect(() => preprocessContentSchema.parse(out.content)).not.toThrow()
  })
})
