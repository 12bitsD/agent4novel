import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { jsonValueSchema } from '@agent4novel/contracts'
import { createApp } from '../src/app.js'
import { KnownError } from '../src/errors.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { fakeArtifactStep } from './fakes.js'
import { caption, creative } from './fixtures/artifact-content.js'

const jsonHeaders = { 'content-type': 'application/json' }

function makePipeline(store: InMemoryStore, creativeStep = fakeArtifactStep('creative', creative('new'))) {
  const captionStep = fakeArtifactStep('caption', caption('must not run'))
  const pipeline = new Pipeline({
    store,
    steps: new Map([['caption', captionStep.step], ['creative', creativeStep.step]]),
    definition: [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    ],
    resolveConfig: () => ({}),
  })
  return { pipeline, captionStep, creativeStep }
}

function appFor(store: InMemoryStore, creativeStep = fakeArtifactStep('creative', creative('new'))) {
  // Keep the full public step input visible to this acceptance seam; the production creative schema is strict.
  creativeStep.step.inputSchema = z.object({ workId: z.string(), seed: z.string(), upstream: jsonValueSchema }).passthrough()
  const made = makePipeline(store, creativeStep)
  return { app: createApp({ store, pipeline: made.pipeline, meta: { demo: true } }), ...made }
}

async function regenerate(app: ReturnType<typeof createApp>, workId: string, request: unknown) {
  return app.request(`/api/works/${workId}/artifacts/creative/regenerate`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(request),
  })
}

describe('creative regeneration acceptance v1', () => {
  it('E1 retries only creative against a null baseline, preserving seed and approved caption', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E1 unique immutable seed' })
    const source = store.appendArtifact(work.id, 'caption', caption('E1 unique approved caption'), { humanStatus: 'approved' })
    const step = fakeArtifactStep('creative', creative('E1 complete direction'))
    const { app, captionStep } = appFor(store, step)

    const response = await regenerate(app, work.id, { expectedArtifactId: null, expectedHeadVersion: null, instructions: 'E1 retry' })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ workId: work.id, kind: 'creative', version: 1, humanStatus: 'pending', content: creative('E1 complete direction') })
    expect(captionStep.seen).toEqual([])
    expect(step.seen).toHaveLength(1)
    expect(step.seen[0]).toMatchObject({ workId: work.id, seed: work.seed, upstream: { caption: source.content }, regeneration: { content: null, instructions: 'E1 retry' } })
    expect(store.getWork(work.id)!.artifacts).toHaveLength(2)
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'caption')).toMatchObject({ id: source.id, version: source.version, humanStatus: 'approved' })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'outline')).toBeUndefined()
  })

  it('E2 sends the complete saved pending package and instruction to the production step, then appends a new pending head', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E2 unique seed' })
    const source = store.appendArtifact(work.id, 'caption', caption('E2 unique caption'), { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', creative('E2 unique old package'))
    const step = fakeArtifactStep('creative', creative('E2 unique new package'))
    const { app } = appFor(store, step)

    const response = await regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: 'E2 unique author thought' })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ id: expect.any(String), version: 2, humanStatus: 'pending', content: creative('E2 unique new package') })
    expect(result.id).not.toBe(old.id)
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'creative')).toMatchObject({ id: result.id, version: 2, humanStatus: 'pending' })
    expect(step.seen[0]).toMatchObject({ seed: work.seed, upstream: { caption: source.content }, regeneration: { content: old.content, instructions: 'E2 unique author thought' } })
  })

  it.each([
    ['timeout', () => new KnownError('llm-timeout', 'safe timeout', { retryable: true }), 504],
    ['invalid output', () => ({ content: { directions: [] } }), 502],
  ])('E3 does not replace the head after %s', async (_name, result, expectedStatus) => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E3 seed' })
    store.appendArtifact(work.id, 'caption', caption('E3 caption'), { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', creative('E3 old'))
    const step = fakeArtifactStep('creative', creative('unused'))
    step.step.run = async () => {
      const value = result()
      if (value instanceof Error) throw value
      return value as { content: never }
    }
    const { app } = appFor(store, step)
    const response = await regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: 'E3' })
    expect(response.status).toBe(expectedStatus)
    expect(await response.json()).toMatchObject({ code: expect.any(String), message: expect.not.stringContaining('E3 old') })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'creative')).toMatchObject({ id: old.id, version: old.version, content: old.content, humanStatus: 'pending' })
  })

  it('E4 rejects incomplete, stale, missing-caption and approved targets before calling the model', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E4 seed' })
    const step = fakeArtifactStep('creative', creative('E4 new'))
    const { app } = appFor(store, step)

    expect((await regenerate(app, work.id, { expectedArtifactId: 'only-id', expectedHeadVersion: null, instructions: '' })).status).toBe(400)
    expect((await regenerate(app, work.id, { expectedArtifactId: null, expectedHeadVersion: null, instructions: '' })).status).toBe(409)
    expect(step.seen).toHaveLength(0)

    const source = store.appendArtifact(work.id, 'caption', caption('E4 caption'), { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', creative('E4 old'))
    expect((await regenerate(app, work.id, { expectedArtifactId: 'stale', expectedHeadVersion: old.version, instructions: '' })).status).toBe(409)
    expect((await regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version + 1, instructions: '' })).status).toBe(409)
    expect(step.seen).toHaveLength(0)

    const select = await app.request(`/api/works/${work.id}/artifacts/creative/select`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ directionId: 'direction-1', expectedHeadVersion: old.version }) })
    expect(select.status).toBe(200)
    const selected = await select.json()
    expect((await regenerate(app, work.id, { expectedArtifactId: selected.id, expectedHeadVersion: selected.version, instructions: '' })).status).toBe(409)
    expect(step.seen).toHaveLength(0)
    expect(source.humanStatus).toBe('approved')
  })

  it('E4 rejects a creative race at commit, preserving the competing head', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E4 race seed' })
    store.appendArtifact(work.id, 'caption', caption('E4 race caption'), { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', creative('E4 race old'))
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const step = fakeArtifactStep('creative', creative('E4 race generated'))
    step.step.run = async input => { step.seen.push(input); await waiting; return { content: creative('E4 race generated') } }
    const { app } = appFor(store, step)
    const pending = regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    store.appendArtifact(work.id, 'creative', creative('E4 competing creative'))
    release()
    expect((await pending).status).toBe(409)
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'creative')?.content).toEqual(creative('E4 competing creative'))
  })

  it('E4 rejects an approved-caption race at commit, preserving the competing caption', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E4 caption race seed' })
    const captionHead = store.appendArtifact(work.id, 'caption', caption('E4 caption race old'), { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', creative('E4 caption race old creative'))
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const step = fakeArtifactStep('creative', creative('E4 caption race generated'))
    step.step.run = async input => { step.seen.push(input); await waiting; return { content: creative('E4 caption race generated') } }
    const { app } = appFor(store, step)
    const pending = regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    store.appendArtifact(work.id, 'caption', caption('E4 caption race competing'))
    release()
    expect((await pending).status).toBe(409)
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'caption')).toMatchObject({ version: captionHead.version + 1, content: caption('E4 caption race competing') })
    expect(step.seen).toHaveLength(1)
  })

  it('E4 shares the per-work generation lock and does not call the model twice', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'E4 lock seed' })
    store.appendArtifact(work.id, 'caption', caption('E4 lock caption'), { humanStatus: 'approved' })
    const old = store.appendArtifact(work.id, 'creative', creative('E4 lock old'))
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const step = fakeArtifactStep('creative', creative('E4 lock new'))
    step.step.run = async input => { step.seen.push(input); await waiting; return { content: creative('E4 lock new') } }
    const { app } = appFor(store, step)
    const first = regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await regenerate(app, work.id, { expectedArtifactId: old.id, expectedHeadVersion: old.version, instructions: '' })).status).toBe(409)
    expect(step.seen).toHaveLength(1)
    release()
    expect((await first).status).toBe(200)
  })
})
