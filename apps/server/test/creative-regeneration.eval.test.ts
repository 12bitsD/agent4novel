import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { fakeArtifactStep } from './fakes.js'
import { caption, creative } from './fixtures/artifact-content.js'

// Frozen E1 tracer bullet: the delivery agent owns these literal expectations.
describe('creative regeneration acceptance v1', () => {
  it('E1 retries only creative against a null baseline, preserving seed and caption', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: '不可变原素材' })
    const source = store.appendArtifact(work.id, 'caption', caption('已通过提炼'), { humanStatus: 'approved' })
    const step = fakeArtifactStep('creative', creative('新的完整方向'))
    const forbiddenCaption = fakeArtifactStep('caption', caption('不应运行'))
    const pipeline = new Pipeline({ store, steps: new Map([['caption', forbiddenCaption.step], ['creative', step.step]]),
      definition: [{ stepId: 'caption', outputKind: 'caption' }, { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } }],
      resolveConfig: () => ({}) })
    const app = createApp({ store, pipeline, meta: { demo: true } })
    const response = await app.request(`/api/works/${work.id}/artifacts/creative/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedArtifactId: null, expectedHeadVersion: null, instructions: '不要穿越' }),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ workId: work.id, kind: 'creative', version: 1, humanStatus: 'pending', content: creative('新的完整方向') })
    expect(forbiddenCaption.seen).toEqual([])
    expect(step.seen).toHaveLength(1)
    expect(store.getWork(work.id)!.seed).toBe('不可变原素材')
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'caption')).toEqual(source)
  })
})
