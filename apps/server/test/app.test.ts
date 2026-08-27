import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { seed } from '../src/seed.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import type { ArtifactStep, PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import type { AgentConfig } from '@agent4novel/contracts'
import { fakeArtifactStep } from './fakes.js'

const jsonHeaders = { 'Content-Type': 'application/json' }

const validCaption = {
  inputStage: '脑洞',
  summary: '素材提炼(测试)',
  elements: [{ kind: '冲突', content: '核心矛盾' }],
  gaps: [],
}

function pack(directionId: string, title = '方向A') {
  return {
    directionId,
    title,
    hook: '一句话钩子',
    tags: ['都市'],
    synopsis: '故事概要。',
    characters: [],
    setting: [],
    payoffs: [],
    outline: [],
  }
}

const validCreative = { directions: [pack('work-1-dir-1'), pack('work-1-dir-2', '方向B')] }

function arc(id: string) {
  return {
    arcId: id,
    title: `弧线${id}`,
    conflict: '核心冲突',
    development: '冲突发展',
    resolution: '矛盾解决与收束局势',
    segments: [1, 2].map((j) => ({
      segmentId: `${id}-seg-${j}`,
      title: `剧情点${j}`,
      summary: '本段发生什么',
      outcome: '本段结束后的局势',
    })),
  }
}

const validOutline = { arcs: [arc('w-arc-1'), arc('w-arc-2'), arc('w-arc-3')] }

// 与生产装配同形:store + pipeline(caption → creative gateAfter → outline gateAfter)+ consumeGuards + meta
function makeApp(opts?: { demo?: boolean; config?: AgentConfig }) {
  const store = new InMemoryStore()
  const caption = fakeArtifactStep('caption', validCaption)
  const creative = fakeArtifactStep('creative', validCreative)
  const outline = fakeArtifactStep('outline', validOutline)
  const steps = new Map<string, ArtifactStep>([
    ['caption', caption.step],
    ['creative', creative.step],
    ['outline', outline.step],
  ])
  const definition: PipelineDefinitionEntry[] = [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
  ]
  const pipeline = new Pipeline({
    store,
    steps,
    definition,
    resolveConfig: () => opts?.config ?? {},
    consumeGuards,
  })
  const app = createApp({ store, pipeline, meta: { demo: opts?.demo ?? true } })
  return { store, app, seen: { caption: caption.seen, creative: creative.seen, outline: outline.seen } }
}

async function advance(app: ReturnType<typeof createApp>, workId: string) {
  const res = await app.request(`/api/works/${workId}/advance`, { method: 'POST' })
  return { res, outcome: (await res.json()) as { kind: string; state: { stage: string } } }
}

describe('works routes', () => {
  it('lists seeded works', async () => {
    const { store, app } = makeApp()
    seed(store)
    const res = await app.request('/api/works')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ title: string; chapterCount: number }>
    expect(body.length).toBe(3)
  })

  it('GET /api/config returns { demo } only(interview 开关已移除)', async () => {
    const { app } = makeApp({ demo: true })
    const res = await app.request('/api/config')
    expect(await res.json()).toEqual({ demo: true })
  })

  it('GET /works/:id returns the read model(workflowState + allowedActions,同一快照)', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    const res = await app.request(`/api/works/${w.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workflowState: string
      allowedActions: string[]
      artifacts: unknown[]
    }
    expect(body.workflowState).toBe('ready-to-generate')
    expect(body.allowedActions).toEqual(['generate'])
    expect(body.artifacts).toEqual([])
  })

  it('returns 404 for an unknown work', async () => {
    const { store, app } = makeApp()
    const res = await app.request('/api/works/nope')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('work-not-found')
  })

  it('creates a work via POST(只创建,不触发 advance)', async () => {
    const { store, app } = makeApp()
    const res = await app.request('/api/works', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ seed: '一个脑洞' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; seed: string }
    expect(body.seed).toBe('一个脑洞')
  })

  it('rejects POST with empty seed', async () => {
    const { store, app } = makeApp()
    const res = await app.request('/api/works', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ seed: '' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('creative flow(#3c 全链路)', () => {
  it('advance chains caption → creative and lands awaiting-selection', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: '一个脑洞' })
    const { res, outcome } = await advance(app, w.id)
    expect(res.status).toBe(200)
    expect(outcome.kind).toBe('advanced')
    expect(outcome.state.stage).toBe('awaiting-approval')

    const detail = store.getWork(w.id)!
    expect(detail.artifacts.find((a) => a.kind === 'caption')?.humanStatus).toBe('approved')
    expect(detail.artifacts.find((a) => a.kind === 'creative')?.humanStatus).toBe('pending')

    const view = (await (await app.request(`/api/works/${w.id}`)).json()) as {
      workflowState: string
      allowedActions: string[]
    }
    expect(view.workflowState).toBe('awaiting-selection')
    expect(view.allowedActions).toContain('select')
  })

  it('creative step receives seed + caption via consumes', async () => {
    const { app, seen } = makeApp()
    const w = (await (
      await app.request('/api/works', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ seed: '种子文本' }),
      })
    ).json()) as { id: string }
    await advance(app, w.id)
    expect(seen.creative[0]).toMatchObject({ seed: '种子文本', upstream: { caption: validCaption } })
  })

  it('saveCreativeDraft stores all directions, always pending, versions up', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)

    const edited = { directions: [pack('work-1-dir-1', '改过的A'), pack('work-1-dir-2', '方向B')] }
    const res = await app.request(`/api/works/${w.id}/artifacts/creative`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: edited, expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(200)
    const a = (await res.json()) as { version: number; humanStatus: string }
    expect(a.version).toBe(2)
    expect(a.humanStatus).toBe('pending')
    // 保存不选定:仍是 awaiting-selection
    expect(store.getWork(w.id)!.artifacts.find((x) => x.kind === 'creative')!.humanStatus).toBe(
      'pending',
    )
  })

  it('save with a stale expectedHeadVersion → 409 version-conflict', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/artifacts/creative`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: validCreative, expectedHeadVersion: 99 }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('version-conflict')
  })

  it('save with invalid content → 422', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/artifacts/creative`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: { directions: [] }, expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(422)
  })

  it('selectCreativeDirection lands a single-direction approved version;读模型回到 ready-to-generate(待生成大纲)', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)

    const res = await app.request(`/api/works/${w.id}/artifacts/creative/select`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ directionId: 'work-1-dir-2', expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(200)
    const a = (await res.json()) as { version: number; humanStatus: string; content: { directions: unknown[] } }
    expect(a.humanStatus).toBe('approved')
    expect(a.content.directions).toHaveLength(1)

    // #4:选定后 definition 未到终点(outline 待生成)→ 读模型回到 ready-to-generate('selected' 态已移除)
    const view = (await (await app.request(`/api/works/${w.id}`)).json()) as {
      workflowState: string
      allowedActions: string[]
    }
    expect(view.workflowState).toBe('ready-to-generate')
    expect(view.allowedActions).toEqual(['generate'])
  })

  it('select with unknown directionId → 409 direction-not-selected', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/artifacts/creative/select`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ directionId: 'nope', expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('direction-not-selected')
  })

  it('select with a stale expectedHeadVersion → 409 version-conflict', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/artifacts/creative/select`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ directionId: 'work-1-dir-1', expectedHeadVersion: 42 }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('version-conflict')
  })

  it('caption 成功 creative 失败 → outcome failed,重试只跑 creative', async () => {
    const store = new InMemoryStore()
    let fail = true
    const flaky: ArtifactStep = {
      id: 'creative',
      inputSchema: fakeArtifactStep('x', null).step.inputSchema,
      outputSchema: fakeArtifactStep('x', null).step.outputSchema,
      async run() {
        if (fail) throw new Error('boom')
        return { content: validCreative }
      },
    }
    const definition: PipelineDefinitionEntry[] = [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    ]
    const pipeline = new Pipeline({
      store,
      steps: new Map<string, ArtifactStep>([
        ['caption', fakeArtifactStep('caption', validCaption).step],
        ['creative', flaky],
      ]),
      definition,
      resolveConfig: () => ({}),
    })
    const app = createApp({ store, pipeline, meta: { demo: true } })
    const w = store.createWork({ seed: 'x' })

    const r1 = await advance(app, w.id)
    expect(r1.res.status).toBe(200)
    expect(r1.outcome.kind).toBe('failed')

    fail = false
    const r2 = await advance(app, w.id)
    expect(r2.outcome.kind).toBe('advanced')
    const caps = store.getWork(w.id)!.artifacts.filter((a) => a.kind === 'caption')
    expect(caps).toHaveLength(1) // caption 未重跑
  })

  it('interview 零残留:answer-interview 路由不存在', async () => {
    const { store, app } = makeApp()
    const w = (await (
      await app.request('/api/works', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ seed: 'x' }),
      })
    ).json()) as { id: string }
    const res = await app.request(`/api/works/${w.id}/answer-interview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ answers: [] }),
    })
    expect(res.status).toBe(404)
  })

  it('通用 approve 对 creative 关闭(只能走 select 选定单方向)', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'creative' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('direction-not-selected')
  })

  it('advance 失败后读模型产出 failed 态(可重试)', async () => {
    const store = new InMemoryStore()
    const flaky: ArtifactStep = {
      id: 'creative',
      inputSchema: fakeArtifactStep('x', null).step.inputSchema,
      outputSchema: fakeArtifactStep('x', null).step.outputSchema,
      async run() {
        throw new Error('boom')
      },
    }
    const definition: PipelineDefinitionEntry[] = [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    ]
    const pipeline = new Pipeline({
      store,
      steps: new Map<string, ArtifactStep>([
        ['caption', fakeArtifactStep('caption', validCaption).step],
        ['creative', flaky],
      ]),
      definition,
      resolveConfig: () => ({}),
    })
    const app = createApp({ store, pipeline, meta: { demo: true } })
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    const view = (await (await app.request(`/api/works/${w.id}`)).json()) as {
      workflowState: string
      allowedActions: string[]
    }
    expect(view.workflowState).toBe('failed')
    expect(view.allowedActions).toEqual(['generate'])
  })
})

describe('outline flow(#4 全链路)', () => {
  async function selectFirst(app: ReturnType<typeof createApp>, workId: string) {
    return app.request(`/api/works/${workId}/artifacts/creative/select`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ directionId: 'work-1-dir-1', expectedHeadVersion: 1 }),
    })
  }

  it('选定后 advance 生成大纲 → awaiting-outline-review;approve → complete', async () => {
    const { store, app, seen } = makeApp()
    const w = store.createWork({ seed: '一个脑洞' })
    await advance(app, w.id) // caption + creative(gate)
    await selectFirst(app, w.id)

    const { outcome } = await advance(app, w.id)
    expect(outcome.kind).toBe('advanced')
    // outline 步骤经 consumes 拿到选定单方向 creative(守卫:恰好 1 方向)
    expect(seen.outline[0]).toMatchObject({
      upstream: { creative: { directions: [pack('work-1-dir-1')] } },
    })
    expect(
      store.getWork(w.id)!.artifacts.find((a) => a.kind === 'outline')?.humanStatus,
    ).toBe('pending')

    const view = (await (await app.request(`/api/works/${w.id}`)).json()) as {
      workflowState: string
      allowedActions: string[]
    }
    expect(view.workflowState).toBe('awaiting-outline-review')
    expect(view.allowedActions).toEqual(['save-draft', 'approve'])

    const res = await app.request(`/api/works/${w.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'outline' }),
    })
    expect(res.status).toBe(200)
    const view2 = (await (await app.request(`/api/works/${w.id}`)).json()) as {
      workflowState: string
    }
    expect(view2.workflowState).toBe('outline-approved')
  })

  it('saveOutlineDraft:永远 pending、版本 +1、新增剧情点被 server 补注入 id', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    await selectFirst(app, w.id)
    await advance(app, w.id)

    const edited = {
      arcs: validOutline.arcs.map((a, i) =>
        i === 0
          ? {
              ...a,
              segments: [
                ...a.segments,
                { title: '新剧情点', summary: '作者手加的一段', outcome: '新局势' }, // 无 segmentId
              ],
            }
          : a,
      ),
    }
    const res = await app.request(`/api/works/${w.id}/artifacts/outline`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: edited, expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(200)
    const saved = (await res.json()) as {
      version: number
      humanStatus: string
      content: { arcs: Array<{ segments: Array<{ segmentId: string }> }> }
    }
    expect(saved.version).toBe(2)
    expect(saved.humanStatus).toBe('pending')
    const segs = saved.content.arcs[0]!.segments
    expect(segs).toHaveLength(3)
    // 新项按「现存最大序号 +1」补注入,与生成时的位置编号格式一致
    expect(segs[2]!.segmentId).toBe('w-arc-1-seg-3')
    // 已有 id 原样保留
    expect(segs[0]!.segmentId).toBe('w-arc-1-seg-1')
    expect(
      store.getWork(w.id)!.artifacts.find((a) => a.kind === 'outline')?.humanStatus,
    ).toBe('pending')
  })

  it('outline 保存 stale expectedHeadVersion → 409 version-conflict', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    await selectFirst(app, w.id)
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/artifacts/outline`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: validOutline, expectedHeadVersion: 99 }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('version-conflict')
  })

  it('outline 保存非法内容(弧线数量越界)→ 422', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    await selectFirst(app, w.id)
    await advance(app, w.id)
    const res = await app.request(`/api/works/${w.id}/artifacts/outline`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: { arcs: [arc('a-1')] }, expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(422)
  })

  it('大纲 approved 后再保存 → 回到 awaiting-outline-review(版本链天然支持)', async () => {
    const { store, app } = makeApp()
    const w = store.createWork({ seed: 'x' })
    await advance(app, w.id)
    await selectFirst(app, w.id)
    await advance(app, w.id)
    await app.request(`/api/works/${w.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'outline' }),
    })
    const res = await app.request(`/api/works/${w.id}/artifacts/outline`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: validOutline, expectedHeadVersion: 1 }),
    })
    expect(res.status).toBe(200)
    const view = (await (await app.request(`/api/works/${w.id}`)).json()) as {
      workflowState: string
    }
    expect(view.workflowState).toBe('awaiting-outline-review')
  })
})
