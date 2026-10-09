import { describe, expect, it } from 'vitest'
import { stepExperimentRequestSchema } from '../src/index.js'

const pack = (id: string) => ({ directionId: id, title: '方向', hook: '钩子', tags: [], synopsis: '概要', characters: [], setting: [], payoffs: [], outline: [] })
const caption = { inputStage: '脑洞' as const, summary: '提炼稿 canary', elements: [], gaps: [] }

describe('creative regeneration experiment contract acceptance', () => {
  it('E6 accepts creative regeneration input for the same production Step', () => {
    const result = stepExperimentRequestSchema.safeParse({
      stepId: 'creative',
      input: {
        seed: 'run-step creative canary seed',
        upstream: { caption },
        regeneration: { content: { directions: [pack('old-direction')] }, instructions: 'run-step creative canary thought' },
      },
    })
    expect(result.success).toBe(true)
  })

  it('E6 rejects an over-limit creative instruction before worker/model execution', () => {
    const result = stepExperimentRequestSchema.safeParse({
      stepId: 'creative', input: { seed: 'seed', upstream: { caption }, regeneration: { content: null, instructions: 'x'.repeat(4001) } },
    })
    expect(result.success).toBe(false)
  })
})
