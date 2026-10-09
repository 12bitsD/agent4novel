import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { fakeArtifactStep } from './fakes.js'
import type { ArtifactStep, PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import type { AgentConfig } from '@agent4novel/contracts'
import { beatCommandResponseSchema, beatVariantSelectionResponseSchema } from '@agent4novel/contracts'
import { KnownError } from '../src/errors.js'

const headers = { 'Content-Type': 'application/json' }
const caption = { inputStage: '脑洞', summary: '摘要', elements: [{ kind: '冲突', content: '线索' }], gaps: [] }
const pack = (id: string) => ({ directionId: id, title: '方向', hook: '钩子', tags: ['都市'], synopsis: '概要', characters: [], setting: [], payoffs: [], outline: [] })
const creative = { directions: [pack('dir-1')] }
const arc = (id: string) => ({ arcId: id, title: '弧线', conflict: '冲突', development: '发展', resolution: '收束', segments: [{ segmentId: `${id}-seg-1`, title: '点一', summary: '发生', outcome: '变化' }, { segmentId: `${id}-seg-2`, title: '点二', summary: '发生', outcome: '变化' }] })
const outline = { arcs: [arc('arc-1'), arc('arc-2'), arc('arc-3')] }
const setting = { overview: '城市', world: [{ itemId: 'world-1', title: '规则', content: '现实' }], characters: [{ itemId: 'character-1', title: '主角', content: '查案' }], factions: [], relationships: [], extensions: [] }
const original = { title: '旧章纲', goal: '守住线索', writingPlan: [{ itemId: 'beat-item-old', title: '问路', content: '主角向守门人问路。' }], ending: '拿到半张地图。' }
const regenerated = { title: '新章纲', goal: '追上真相', writingPlan: [{ itemId: 'beat-item-old', title: '跟踪', content: '主角沿河追踪。' }], ending: '看见旧桥上的灯。' }

function makeFixture(step: ArtifactStep = fakeArtifactStep('beat', regenerated).step) {
  const store = new InMemoryStore(); const work = store.createWork({ seed: '素材' })
  for (const [kind, content] of [['caption', caption], ['creative', creative], ['outline', outline], ['setting', setting]] as const) {
    const artifact = store.appendArtifact(work.id, kind, content)
    if (kind === 'setting') store.finalizeArtifact({ workId: work.id, kind, expectedArtifactId: artifact.id, expectedHeadVersion: artifact.version, content })
    else store.setStatus(work.id, kind, 'approved', { preconditions: [{ kind, head: { artifactId: artifact.id, version: artifact.version, humanStatus: 'pending' } }] })
  }
  const beat = store.appendArtifact(work.id, 'beat', original, { chapter: 1 })
  const steps = new Map<string, ArtifactStep>([
    ['caption', fakeArtifactStep('caption', caption).step], ['creative', fakeArtifactStep('creative', creative).step], ['outline', fakeArtifactStep('outline', outline).step], ['setting', fakeArtifactStep('setting', setting).step], ['beat', step],
  ])
  const definition: PipelineDefinitionEntry[] = [
    { stepId: 'caption', outputKind: 'caption' }, { stepId: 'creative', outputKind: 'creative', consumes: ['caption'] },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'] }, { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'] },
    { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
  ]
  const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({} as AgentConfig), consumeGuards })
  return { store, work, beat, app: createApp({ store, pipeline, meta: { demo: true } }) }
}

describe('E20 server acceptance: compare/select beat variants', () => {
  it('returns complete A/B receipts, keeps B pending, and lets explicit new choice approve only B', async () => {
    const fx = makeFixture();
    const regen = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original, instructions: '更紧张' }) })
    expect(regen.status).toBe(200); const body = await regen.json() as any
    expect(() => beatCommandResponseSchema.parse(body)).not.toThrow()
    expect(body.comparison).toMatchObject({ original: fx.beat, candidate: body.artifact })
    expect(body.comparison.original.content).toEqual(original)
    expect(body.comparison.candidate.content).toEqual(regenerated)
    expect(body.comparison.candidate.humanStatus).toBe('pending')
    expect(body.comparison.candidate.id).toBe(body.artifact.id)
    expect(body.comparison.candidate.version).toBe(2)
    const current = await fx.app.request(`/api/works/${fx.work.id}`)
    expect(current.status).toBe(200)
    expect((await current.json() as any).artifacts.find((a: any) => a.kind === 'beat' && a.chapter === 1)).toMatchObject({ id: body.artifact.id, version: 2, humanStatus: 'pending' })
    const candidate = body.artifact
    const choose = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/select`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: candidate.id, expectedHeadVersion: candidate.version,
        originalArtifactId: fx.beat.id, originalVersion: fx.beat.version, originalContent: original, choice: 'new' }) })
    expect(choose.status).toBe(200); const selected = await choose.json() as any
    expect(() => beatVariantSelectionResponseSchema.parse(selected)).not.toThrow()
    expect(selected.artifact).toEqual(candidate)
    expect(selected.comparison).toMatchObject({ original: fx.beat, candidate })
    expect(selected.selection).toMatchObject({ operation: 'select-beat-variant', choice: 'new', writeOutcome: 'not-committed', resultHead: { artifactId: candidate.id, version: 2, humanStatus: 'pending' } })
    const approve = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: selected.artifact.id, expectedHeadVersion: 3, content: selected.artifact.content }) })
    expect(approve.status).toBe(409)
    const wrongApprove = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original }) })
    expect(wrongApprove.status).toBe(409)
    const approveNew = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: selected.artifact.id, expectedHeadVersion: 2, content: selected.artifact.content }) })
    expect(approveNew.status).toBe(200); expect((await approveNew.json()).artifact.humanStatus).toBe('approved')
    expect(fx.store.getArtifactVersion(fx.work.id, 'beat', 1, fx.beat.id, 1)?.content).toEqual(original)
    expect(fx.store.getArtifactVersion(fx.work.id, 'beat', 1, candidate.id, 2)?.humanStatus).toBe('approved')
    expect(fx.store.getWork(fx.work.id)!.artifacts.filter(a => a.kind === 'beat' && a.chapter === 1)).toHaveLength(1)
  })

  it('copies A as a new C only for explicit old choice and preserves A/B/C history', async () => {
    const fx = makeFixture()
    const regen = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original, instructions: '更紧张' }) })
    const candidate = (await regen.json() as any).artifact
    const chooseOld = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/select`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: candidate.id, expectedHeadVersion: candidate.version,
        originalArtifactId: fx.beat.id, originalVersion: fx.beat.version, originalContent: original, choice: 'original' }) })
    expect(chooseOld.status).toBe(200); const selected = await chooseOld.json() as any
    expect(() => beatVariantSelectionResponseSchema.parse(selected)).not.toThrow()
    expect(selected.artifact.version).toBe(3)
    expect(selected.artifact.id).not.toBe(fx.beat.id)
    expect(selected.artifact.id).not.toBe(candidate.id)
    expect(selected.artifact.content).toEqual(original)
    expect(selected.artifact.humanStatus).toBe('pending')
    expect(selected.comparison).toMatchObject({ original: fx.beat, candidate })
    expect(fx.store.getArtifactVersion(fx.work.id, 'beat', 1, fx.beat.id, 1)?.content).toEqual(original)
    expect(fx.store.getArtifactVersion(fx.work.id, 'beat', 1, candidate.id, 2)?.content).toEqual(regenerated)
    expect(fx.store.getArtifactVersion(fx.work.id, 'beat', 1, selected.artifact.id, 3)?.content).toEqual(original)
    for (const stale of [
      { expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original },
      { expectedArtifactId: candidate.id, expectedHeadVersion: 2, content: candidate.content },
    ]) {
      const rejected = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
        body: JSON.stringify({ chapter: 1, ...stale }) })
      expect(rejected.status).toBe(409)
    }
    const approve = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: selected.artifact.id, expectedHeadVersion: 3, content: selected.artifact.content }) })
    expect(approve.status).toBe(200); expect((await approve.json()).artifact.id).toBe(selected.artifact.id)
    expect(fx.store.getWork(fx.work.id)!.artifacts.filter(a => a.kind === 'beat' && a.chapter === 1).map(a => [a.id, a.version, a.humanStatus])).toEqual([[selected.artifact.id, 3, 'approved']])
  })

  it('rejects missing, stale, non-current, and approved identities before the model, with no half-write', async () => {
    const seen: unknown[] = []; const step: ArtifactStep = { ...fakeArtifactStep('beat', regenerated).step, async run(input) { seen.push(input); throw new Error('synthetic provider failure') } }
    const fx = makeFixture(step)
    const response = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: 'stale', expectedHeadVersion: 1, content: original, instructions: '' }) })
    expect(response.status).toBe(409); expect(seen).toHaveLength(0)
    const failed = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original, instructions: '' }) })
    expect(failed.status).toBe(500); expect(seen).toHaveLength(1); expect(fx.store.getWork(fx.work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)?.version).toBe(1)

    const healthySeen: unknown[] = []
    const healthyStep: ArtifactStep = { ...fakeArtifactStep('beat', regenerated).step, async run(input) { healthySeen.push(input); return { content: regenerated } } }
    const healthy = makeFixture(healthyStep)
    const generated = await healthy.app.request(`/api/works/${healthy.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: healthy.beat.id, expectedHeadVersion: 1, content: original, instructions: '' }) })
    const b = (await generated.json() as any).artifact
    const missing = await healthy.app.request(`/api/works/${healthy.work.id}/artifacts/beat/select`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: b.id, expectedHeadVersion: 2, originalArtifactId: 'missing', originalVersion: 1, originalContent: original, choice: 'new' }) })
    expect(missing.status).toBe(409); expect(healthySeen).toHaveLength(1)
    const nonCurrent = await healthy.app.request(`/api/works/${healthy.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 2, expectedArtifactId: healthy.beat.id, expectedHeadVersion: 1, content: original, instructions: '' }) })
    expect(nonCurrent.status).toBe(409); expect(healthySeen).toHaveLength(1)
    const stale = await healthy.app.request(`/api/works/${healthy.work.id}/artifacts/beat/select`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: healthy.beat.id, expectedHeadVersion: 1, originalArtifactId: healthy.beat.id, originalVersion: 1, originalContent: original, choice: 'new' }) })
    expect(stale.status).toBe(409); expect(healthySeen).toHaveLength(1)
    const approved = await healthy.app.request(`/api/works/${healthy.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: b.id, expectedHeadVersion: 2, content: b.content }) })
    expect(approved.status).toBe(200)
    const afterApprove = await healthy.app.request(`/api/works/${healthy.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: b.id, expectedHeadVersion: 2, content: b.content, instructions: '' }) })
    expect(afterApprove.status).toBe(409); expect(healthySeen).toHaveLength(1)

    const race = makeFixture(healthyStep)
    const first = await race.app.request(`/api/works/${race.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: race.beat.id, expectedHeadVersion: 1, content: original, instructions: '' }) })
    const firstB = (await first.json() as any).artifact
    const selectBody = { chapter: 1, expectedArtifactId: firstB.id, expectedHeadVersion: 2, originalArtifactId: race.beat.id, originalVersion: 1, originalContent: original, choice: 'original' }
    const [winner, loser] = await Promise.all([1, 2].map(() => race.app.request(`/api/works/${race.work.id}/artifacts/beat/select`, { method: 'POST', headers, body: JSON.stringify(selectBody) })))
    expect([winner.status, loser.status].sort()).toEqual([200, 409])
    expect(race.store.getWork(race.work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)?.version).toBe(3)

    const timeoutStep: ArtifactStep = { ...fakeArtifactStep('beat', regenerated).step, async run() { throw new KnownError('llm-timeout', 'synthetic timeout') } }
    const timeoutFx = makeFixture(timeoutStep)
    const timeout = await timeoutFx.app.request(`/api/works/${timeoutFx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: timeoutFx.beat.id, expectedHeadVersion: 1, content: original, instructions: '' }) })
    expect(timeout.status).toBe(504)
    expect(timeoutFx.store.getWork(timeoutFx.work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)?.version).toBe(1)
  })
})
