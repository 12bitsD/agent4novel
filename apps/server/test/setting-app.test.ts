import { describe, expect, it } from 'vitest'
import { settingApproveResponseSchema, settingLimits } from '@agent4novel/contracts'
import { z } from 'zod'
import type { FinalizeArtifactInput } from '../src/store/work-store.js'
import { createApp } from '../src/app.js'
import { Pipeline, type ArtifactStep, type PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { fakeArtifactStep } from './fakes.js'

const headers = { 'Content-Type': 'application/json' }
const setting = {
  overview: '一个失去记忆的人寻找归途。',
  world: [{ itemId: 'item-world', title: '雾中小镇', content: '钟声响起后道路改变。' }],
  characters: [{ itemId: 'item-character', title: '旅人', content: '想要找回自己的名字。' }],
  factions: [], relationships: [], extensions: [],
}

function setup(store = new InMemoryStore()) {
  const work = store.createWork({ seed: '雾中小镇，寻找名字' })
  const definition: PipelineDefinitionEntry[] = [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
    { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
  ]
  const creative = { directions: [{ directionId: 'd1', title: '方向', hook: '钩子', tags: [], synopsis: '故事', characters: [], setting: [], payoffs: [], outline: [] }] }
  for (const [kind, content] of [['caption', '提炼稿'], ['creative', creative], ['outline', '已通过大纲']] as const) {
    store.appendArtifact(work.id, kind, content)
    store.setStatus(work.id, kind, 'approved')
  }
  const steps = new Map<string, ArtifactStep>(definition.map((entry) => [entry.stepId, fakeArtifactStep(entry.stepId, setting).step]))
  const pipeline = new Pipeline({ store, steps, definition, consumeGuards, resolveConfig: () => ({}) })
  const app = createApp({ store, pipeline, meta: { demo: true } })
  const pending = store.appendArtifact(work.id, 'setting', setting)
  const approve = (body: unknown) => app.request(`/api/works/${work.id}/artifacts/setting/approve`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { app, store, pipeline, work, pending, approve }
}

describe('Setting approval HTTP boundary', () => {
  it('reads pending and completed Setting as the fourth gate', async () => {
    const { app, work, approve } = setup()
    const before = await app.request(`/api/works/${work.id}`)
    expect(before.status).toBe(200)
    expect(await before.json()).toMatchObject({ workflowState: 'awaiting-setting-review', nextStepId: null, allowedActions: ['approve'] })
    expect((await approve({ content: setting, expectedHeadVersion: 1 })).status).toBe(200)
    const after = await app.request(`/api/works/${work.id}`)
    expect(await after.json()).toMatchObject({ workflowState: 'setting-approved', nextStepId: null, allowedActions: [] })
  })

  it('rejects the generic HTTP approval command without changing pending content', async () => {
    const { app, work, store } = setup()
    const response = await app.request(`/api/works/${work.id}/approve`, { method: 'POST', headers, body: JSON.stringify({ kind: 'setting' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'setting-approval-required', retryable: false })
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')?.humanStatus).toBe('pending')
  })

  it('publishes the edited full content on the same pending artifact identity and version', async () => {
    const { approve, pending } = setup()
    const response = await approve({ content: { ...setting, overview: '作者通过的总览' }, expectedHeadVersion: 1 })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: pending.id, version: 1, humanStatus: 'approved', content: { overview: '作者通过的总览' } })
  })

  it('allocates distinct new IDs while preserving the ID of a card moved to another column', async () => {
    const { approve } = setup()
    const response = await approve({ content: {
      ...setting,
      world: [{ title: '新世界规则', content: '甲' }, { title: '另一条规则', content: '乙' }],
      factions: setting.world,
      extensions: [{ title: '补充', items: [{ title: '术语', content: '释义' }] }],
    }, expectedHeadVersion: 1 })
    expect(response.status).toBe(200)
    const body = settingApproveResponseSchema.parse(await response.json())
    expect(body.content.factions[0]!.itemId).toBe('item-world')
    const ids = [body.content.world[0]!.itemId, body.content.world[1]!.itemId, body.content.extensions[0]!.sectionId, body.content.extensions[0]!.items[0]!.itemId]
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(4)
    expect(ids).not.toContain('item-world')
    expect(ids).not.toContain('item-character')
  })

  it('rejects an item ID that does not belong to the pending baseline without writing', async () => {
    const { approve, store, work, pending } = setup()
    const response = await approve({ content: { ...setting, world: [{ ...setting.world[0], itemId: 'foreign-item' }] }, expectedHeadVersion: 1 })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'invalid-content', issues: [{ path: ['content', 'world', 0, 'itemId'] }] })
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')).toEqual(pending)
  })

  it('limits the body before JSON parsing even without a Content-Length header', async () => {
    const { app, work, store, pending } = setup()
    const response = await app.request(`/api/works/${work.id}/artifacts/setting/approve`, {
      method: 'POST', headers, body: ' '.repeat(settingLimits.bodyBytes + 1),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: 'payload-too-large' })
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')).toEqual(pending)
  })

  it.each([
    { name: 'unknown outer field', content: { content: setting, expectedHeadVersion: 1, extra: true }, status: 400 },
    { name: 'invalid version', content: { content: setting, expectedHeadVersion: 0 }, status: 400 },
    { name: 'unknown content field', content: { content: { ...setting, extra: true }, expectedHeadVersion: 1 }, status: 422 },
    { name: 'empty world', content: { content: { ...setting, world: [] }, expectedHeadVersion: 1 }, status: 422 },
    { name: 'duplicate ID', content: { content: { ...setting, characters: setting.world }, expectedHeadVersion: 1 }, status: 422 },
    { name: 'item ID used as section ID', content: { content: { ...setting, world: [{ title: '新规则', content: '正文' }], extensions: [{ sectionId: 'item-world', title: '补充', items: [{ title: '新卡', content: '正文' }] }] }, expectedHeadVersion: 1 }, status: 422 },
  ])('rejects $name without changing stored content', async ({ content, status }) => {
    const { approve, store, work, pending } = setup()
    expect((await approve(content)).status).toBe(status)
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')).toEqual(pending)
  })

  it('first approval wins and repeated or different submissions never create another version', async () => {
    const { approve, store, work, pending } = setup()
    const first = { content: { ...setting, world: [{ title: '重新建立的卡片', content: '新事实' }] }, expectedHeadVersion: 1 }
    const responses = await Promise.all([approve(first), approve({ content: setting, expectedHeadVersion: 1 })])
    expect(responses.map((response) => response.status)).toEqual([200, 409])
    expect(await responses[1]!.json()).toMatchObject({ code: 'artifact-already-approved' })
    const repeated = await approve(first)
    expect(repeated.status).toBe(409)
    expect(await repeated.json()).toMatchObject({ code: 'artifact-already-approved' })
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')).toMatchObject({
      id: pending.id, version: 1, humanStatus: 'approved', content: { world: [{ title: '重新建立的卡片' }] },
    })
  })

  it('shows the earlier pending gate, rejects stale approval, then restores the same Setting after upstream approval', async () => {
    const { app, store, pipeline, work, pending, approve } = setup()
    store.appendArtifact(work.id, 'outline', '作者修改大纲')
    expect(await (await app.request(`/api/works/${work.id}`)).json()).toMatchObject({ workflowState: 'awaiting-outline-review' })
    const rejected = await approve({ content: setting, expectedHeadVersion: 1 })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ code: 'setting-gate-not-ready' })
    pipeline.approve(work.id, 'outline')
    expect(await (await app.request(`/api/works/${work.id}`)).json()).toMatchObject({ workflowState: 'awaiting-setting-review' })
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')).toEqual(pending)
    expect((await approve({ content: setting, expectedHeadVersion: 1 })).status).toBe(200)
  })

  it('rejects direct Pipeline approval without changing the Setting', () => {
    const { pipeline, store, work, pending } = setup()
    expect(() => pipeline.approve(work.id, 'setting')).toThrow(expect.objectContaining({ code: 'setting-approval-required' }))
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')).toEqual(pending)
  })

  it('does not turn an exception after a committed write into a definite 4xx rejection', async () => {
    class LostResponseStore extends InMemoryStore {
      override finalizeArtifact(request: FinalizeArtifactInput): never {
        super.finalizeArtifact(request)
        throw new z.ZodError([{ code: 'custom', path: [], message: 'response construction failed' }])
      }
    }
    const { approve, store, work } = setup(new LostResponseStore())
    const response = await approve({ content: setting, expectedHeadVersion: 1 })
    expect(response.status).toBe(500)
    expect(store.getWork(work.id)!.artifacts.find((a) => a.kind === 'setting')?.humanStatus).toBe('approved')
  })
})
