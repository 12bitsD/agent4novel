import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { fakeArtifactStep } from './fakes.js'
import { createCreativeStep } from '../src/steps/creative-step.js'

const mocks = vi.hoisted(() => ({ generateObject: vi.fn(), languageModel: vi.fn(() => 'creative-canary-model') }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({
  modelRuntime: {
    defaultModelId: 'deepseek:deepseek-chat', requestTimeoutMs: 120_000,
    generationSettings: () => ({ parameters: {}, options: {} }), languageModel: mocks.languageModel,
  },
}))

const pack = (title: string) => ({ title, hook: 'hook', tags: ['canary'], synopsis: 'synopsis', characters: [], setting: [], payoffs: [], outline: [] })
const caption = { inputStage: '脑洞' as const, summary: 'REAL-CAPTION-CANARY', elements: [], gaps: [] }
const oldContent = { directions: [{ directionId: 'old-direction', title: 'OLD-PACKAGE-CANARY', hook: 'old-hook', tags: [], synopsis: 'old-synopsis', characters: [], setting: [], payoffs: [], outline: [] }] }

function makeApp(store: InMemoryStore) {
  const pipeline = new Pipeline({
    store,
    steps: new Map([
      ['caption', fakeArtifactStep('caption', caption).step],
      ['creative', createCreativeStep()],
    ]),
    definition: [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    ],
    resolveConfig: () => ({}),
  })
  return createApp({ store, pipeline, meta: { demo: true } })
}

describe('creative regeneration HTTP with the production Step', () => {
  beforeEach(() => mocks.generateObject.mockReset())

  it('E2 sends the exact frozen package through HTTP to createCreativeStep and commits a new pending head', async () => {
    mocks.generateObject.mockResolvedValue({ object: { directions: [pack('new-A'), pack('new-B')] }, usage: {}, finishReason: 'stop' })
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'REAL-SEED-CANARY' })
    store.appendArtifact(work.id, 'caption', caption, { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', oldContent)
    const app = makeApp(store)

    const response = await app.request(`/api/works/${work.id}/artifacts/creative/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: 'REAL-INSTRUCTION-CANARY' }),
    })

    expect(response.status).toBe(200)
    const result = await response.json() as { id: string }
    expect(result).toMatchObject({ workId: work.id, kind: 'creative', version: 2, humanStatus: 'pending', id: expect.any(String) })
    expect(result.id).not.toBe(old.id)
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
    const call = mocks.generateObject.mock.calls[0]![0] as { system: string; prompt: string }
    expect(call.system).toContain('创意')
    for (const value of ['REAL-SEED-CANARY', 'REAL-CAPTION-CANARY', 'OLD-PACKAGE-CANARY', 'REAL-INSTRUCTION-CANARY']) expect(call.prompt).toContain(value)
    expect(mocks.languageModel).toHaveBeenCalledWith('deepseek:deepseek-chat')
  })
})
