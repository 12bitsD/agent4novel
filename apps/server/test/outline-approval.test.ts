import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { SqliteStore } from '../src/store/sqlite-store.js'
import type { WorkStore } from '../src/store/work-store.js'
import { fakeArtifactStep } from './fakes.js'
import { outline } from './fixtures/artifact-content.js'

const opened: SqliteStore[] = []
afterEach(() => { for (const store of opened.splice(0)) store.close() })
const makeStore = (adapter: 'memory' | 'sqlite') => {
  if (adapter === 'memory') return new InMemoryStore()
  const store = new SqliteStore(':memory:')
  opened.push(store)
  return store
}
const makeApp = (store: WorkStore) => {
  const step = fakeArtifactStep('outline', outline('合成大纲'))
  const pipeline = new Pipeline({ store, steps: new Map([['outline', step.step]]),
    definition: [{ stepId: 'outline', outputKind: 'outline', gateAfter: { kind: 'outline' } }], resolveConfig: () => ({}) })
  return { app: createApp({ store, pipeline, meta: { demo: true } }), seen: step.seen }
}
const post = (app: ReturnType<typeof createApp>, workId: string, body: unknown) => app.request(`/api/works/${workId}/artifacts/outline/approve`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('visible Outline approval over HTTP', () => {
  it.each(['memory', 'sqlite'] as const)('approves only the explicit %s head and replays it without changing its identity', async adapter => {
    const store = makeStore(adapter)
    const work = store.createWork({ seed: '合成素材' })
    const head = store.appendArtifact(work.id, 'outline', outline('作者可见大纲'))
    const { app, seen } = makeApp(store)
    const request = { expectedArtifactId: head.id, expectedHeadVersion: head.version }
    const approved = { ...head, humanStatus: 'approved' }

    const result = await post(app, work.id, request)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(approved)
    const replay = await post(app, work.id, request)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(approved)
    expect(store.getWork(work.id)!.artifacts).toEqual([approved])
    expect(store.headVersion(work.id, 'outline')).toBe(1)
    expect(seen).toEqual([])
  })
  it('does not erase a later generation failure when replaying an already approved Outline', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: '合成素材' })
    const head = store.appendArtifact(work.id, 'outline', outline('已通过大纲'))
    store.setStatus(work.id, 'outline', 'approved')
    const outlineStep = fakeArtifactStep('outline', outline('合成大纲'))
    const settingStep = fakeArtifactStep('setting', {})
    const pipeline = new Pipeline({ store, steps: new Map([['outline', outlineStep.step], ['setting', settingStep.step]]),
      definition: [{ stepId: 'outline', outputKind: 'outline', gateAfter: { kind: 'outline' } },
        { stepId: 'setting', outputKind: 'setting', consumes: ['outline'], gateAfter: { kind: 'setting' } }], resolveConfig: () => ({}) })
    const app = createApp({ store, pipeline, meta: { demo: true } })
    const failed = await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    expect(await failed.json()).toMatchObject({ kind: 'failed', stepId: 'setting' })
    const replay = await post(app, work.id, { expectedArtifactId: head.id, expectedHeadVersion: head.version })
    expect(replay.status).toBe(200)
    const view = await app.request(`/api/works/${work.id}`)
    expect(await view.json()).toMatchObject({ workflowState: 'failed', nextStepId: 'setting' })
    expect(settingStep.seen).toHaveLength(1)
  })

  it.each(['memory', 'sqlite'] as const)('rejects stale or different %s identities and keeps legacy current-head approval compatible', async adapter => {
    const store = makeStore(adapter)
    const work = store.createWork({ seed: '合成素材' })
    const first = store.appendArtifact(work.id, 'outline', outline('A读取的第一版'))
    const { app, seen } = makeApp(store)
    const second = store.appendArtifact(work.id, 'outline', outline('B保存的第二版'))
    const stale = await post(app, work.id, { expectedArtifactId: first.id, expectedHeadVersion: first.version })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'version-conflict', retryable: false })
    const different = await post(app, work.id, { expectedArtifactId: first.id, expectedHeadVersion: second.version })
    expect(different.status).toBe(409)
    expect(store.getWork(work.id)!.artifacts).toEqual([second])
    const legacy = await app.request(`/api/works/${work.id}/approve`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'outline' }) })
    expect(legacy.status).toBe(200)
    expect(store.getWork(work.id)!.artifacts).toEqual([{ ...second, humanStatus: 'approved' }])
    expect(seen).toEqual([])
    const oldReplay = await post(app, work.id, { expectedArtifactId: first.id, expectedHeadVersion: first.version })
    expect(oldReplay.status).toBe(409)
  })

  it.each(['memory', 'sqlite'] as const)('rechecks the observed %s Outline at the public Store commit seam', async adapter => {
    const store = makeStore(adapter)
    const work = store.createWork({ seed: '合成素材' })
    const first = store.appendArtifact(work.id, 'outline', outline('作者可见第一版'))
    const { app } = makeApp(store)
    const writeStatus = store.setStatus.bind(store)
    // Interleave a second client's public append before the adapter's actual CAS write.
    store.setStatus = (...args: Parameters<WorkStore['setStatus']>) => {
      store.appendArtifact(work.id, 'outline', outline('在提交前保存的第二版'))
      writeStatus(...args)
    }
    const result = await post(app, work.id, { expectedArtifactId: first.id, expectedHeadVersion: first.version })
    expect(result.status).toBe(409)
    expect(store.getWork(work.id)!.artifacts[0]).toMatchObject({ kind: 'outline', version: 2, humanStatus: 'pending',
      content: { arcs: [{ title: '在提交前保存的第二版' }, { title: '在提交前保存的第二版' }, { title: '在提交前保存的第二版' }] } })
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects the invalid version %s without changing the head', async expectedHeadVersion => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: '合成素材' })
    const head = store.appendArtifact(work.id, 'outline', outline('未改变的大纲'))
    const { app } = makeApp(store)
    const result = await post(app, work.id, { expectedArtifactId: head.id, expectedHeadVersion })
    expect(result.status).toBe(400)
    expect(await result.json()).toMatchObject({ code: 'invalid-input', retryable: false })
    expect(store.getWork(work.id)!.artifacts).toEqual([head])
  })

  it('rejects extra input, malformed JSON and oversized bodies with safe errors', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: '合成素材' })
    const head = store.appendArtifact(work.id, 'outline', outline('未改变的大纲'))
    const { app } = makeApp(store)
    const extra = await post(app, work.id, { expectedArtifactId: head.id, expectedHeadVersion: head.version, secret: 'PRIVATE_INPUT_SENTINEL' })
    expect(extra.status).toBe(400)
    expect(await extra.text()).not.toContain('PRIVATE_INPUT_SENTINEL')
    const malformed = await app.request(`/api/works/${work.id}/artifacts/outline/approve`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{"PRIVATE_INPUT_SENTINEL":' })
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).not.toContain('PRIVATE_INPUT_SENTINEL')
    const large = await post(app, work.id, { expectedArtifactId: 'x'.repeat(5000), expectedHeadVersion: 1 })
    expect(large.status).toBe(413)
    expect(store.getWork(work.id)!.artifacts).toEqual([head])
  })

  it('returns distinct safe 404 errors for a missing work or Outline', async () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: '合成素材' })
    const { app } = makeApp(store)
    const request = { expectedArtifactId: 'absent', expectedHeadVersion: 1 }
    const missingWork = await post(app, 'missing-work', request)
    expect(missingWork.status).toBe(404)
    expect(await missingWork.json()).toMatchObject({ code: 'work-not-found' })
    const missingOutline = await post(app, work.id, request)
    expect(missingOutline.status).toBe(404)
    expect(await missingOutline.json()).toMatchObject({ code: 'artifact-not-found' })
  })

  it('does not manufacture a rejection or exact operation receipt when the storage reply fails after commit', async () => {
    class LostReplyStore extends InMemoryStore {
      override setStatus(...args: Parameters<WorkStore['setStatus']>) {
        super.setStatus(...args)
        throw new Error('PRIVATE_STORAGE_SENTINEL')
      }
    }
    const store = new LostReplyStore()
    const work = store.createWork({ seed: '合成素材' })
    const head = store.appendArtifact(work.id, 'outline', outline('已提交的大纲'))
    const { app } = makeApp(store)
    const result = await post(app, work.id, { expectedArtifactId: head.id, expectedHeadVersion: head.version })
    expect(result.status).toBe(500)
    expect(await result.json()).toEqual({ code: 'internal-error', message: 'response unavailable', retryable: false })
    expect(store.getWork(work.id)!.artifacts).toEqual([{ ...head, humanStatus: 'approved' }])
    expect(store.headVersion(work.id, 'outline')).toBe(1)
  })

})
