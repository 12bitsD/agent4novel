import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { fakeArtifactStep } from './fakes.js'
import type { ArtifactStep, PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import type { AgentConfig } from '@agent4novel/contracts'

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
  it('returns A/B, keeps B pending, copies A as C, and approves only the selected head', async () => {
    const fx = makeFixture();
    const regen = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original, instructions: '更紧张' }) })
    expect(regen.status).toBe(200); const body = await regen.json() as any
    expect(body.comparison.original.id).toBe(fx.beat.id); expect(body.comparison.candidate.humanStatus).toBe('pending'); expect(body.artifact.version).toBe(2)
    const candidate = body.artifact
    const chooseOld = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/select`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: candidate.id, expectedHeadVersion: candidate.version,
        originalArtifactId: fx.beat.id, originalVersion: fx.beat.version, originalContent: original, choice: 'original' }) })
    expect(chooseOld.status).toBe(200); const selected = await chooseOld.json() as any
    expect(selected.artifact.version).toBe(3); expect(selected.artifact.content).toEqual(fx.beat.content)
    const approve = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/approve`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: selected.artifact.id, expectedHeadVersion: 3, content: selected.artifact.content }) })
    expect(approve.status).toBe(200); expect((await approve.json()).artifact.humanStatus).toBe('approved')
    expect(fx.store.getArtifactVersion(fx.work.id, 'beat', 1, fx.beat.id, 1)?.content).toEqual(original)
    expect(fx.store.getWork(fx.work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)?.version).toBe(3)
  })

  it('rejects stale or approved targets before the model and leaves no new head on failure', async () => {
    const seen: unknown[] = []; const step: ArtifactStep = { ...fakeArtifactStep('beat', regenerated).step, async run(input) { seen.push(input); throw new Error('synthetic provider failure') } }
    const fx = makeFixture(step)
    const response = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: 'stale', expectedHeadVersion: 1, content: original, instructions: '' }) })
    expect(response.status).toBe(409); expect(seen).toHaveLength(0)
    const failed = await fx.app.request(`/api/works/${fx.work.id}/artifacts/beat/regenerate`, { method: 'POST', headers,
      body: JSON.stringify({ chapter: 1, expectedArtifactId: fx.beat.id, expectedHeadVersion: 1, content: original, instructions: '' }) })
    expect(failed.status).toBe(500); expect(seen).toHaveLength(1); expect(fx.store.getWork(fx.work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)?.version).toBe(1)
  })
})
