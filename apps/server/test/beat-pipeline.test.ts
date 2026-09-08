import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonValueSchema, settingContentSchema, workViewSchema, beatCommandErrorSchema, beatContentSchema, advanceOutcomeDtoSchema } from '@agent4novel/contracts'
import { Pipeline, type ArtifactStep } from '../src/pipeline/pipeline.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { createApp } from '../src/app.js'
import { approveSetting } from '../src/setting-review.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep } from '../src/steps/fake-step.js'
import * as fakeSteps from '../src/steps/fake-step.js'
import { recordTelemetry } from '../src/steps/telemetry.js'
import { KnownError } from '../src/errors.js'

const beatContent = {
  title: '第一章：失踪的名字', goal: '让主角决定寻找失踪者。',
  writingPlan: [{ itemId: 'beat-item-11111111-1111-4111-8111-111111111111', title: '发现空白', content: '主角发现名册异常，主动追问。' }],
  ending: '主角循线走向旧码头。',
}

async function ready(run?: ArtifactStep['run'], store = new InMemoryStore()) {
  const beat: ArtifactStep = {
    id: 'beat',
    inputSchema: z.object({ workId: z.string(), seed: z.string(), upstream: jsonValueSchema, chapter: z.literal(1),
      regeneration: z.object({ content: jsonValueSchema, instructions: z.string() }).optional(),
    }),
    outputSchema: z.object({ content: jsonValueSchema }),
    run: run ?? (async () => ({ content: beatContent })),
  }
  const pipeline = new Pipeline({
    store, consumeGuards, resolveConfig: () => ({ directionCount: 1 }),
    steps: new Map([
      ['caption', createFakeCaptionStep()], ['creative', createFakeCreativeStep()],
      ['outline', createFakeOutlineStep()], ['setting', createFakeSettingStep()], ['beat', beat],
    ]),
    definition: [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
      { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
      { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
      { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
    ],
  })
  const work = store.createWork({ seed: '合成素材：寻找雾城失踪的名字' })
  await pipeline.advance(work.id)
  pipeline.approve(work.id, 'creative')
  await pipeline.advance(work.id)
  pipeline.approve(work.id, 'outline')
  await pipeline.advance(work.id)
  const setting = store.getWork(work.id)!.artifacts.find(a => a.kind === 'setting')!
  approveSetting(store, work.id, { content: settingContentSchema.parse(setting.content), expectedHeadVersion: setting.version })
  return { store, pipeline, work, app: createApp({ store, pipeline, meta: { demo: true } }) }
}

describe('first chapter Beat', () => {
  it('allows a fake downstream consumer only after approval and supplies the author-final content', async () => {
    const { app, work, store } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    const consumed: unknown[] = []
    const consumer: ArtifactStep = {
      id: 'consumer', inputSchema: z.any(), outputSchema: z.object({ content: jsonValueSchema }),
      async run(input) { consumed.push(input.upstream); return { content: { text: 'test-only consumer' } } },
    }
    const downstream = new Pipeline({ store, consumeGuards, resolveConfig: () => ({}),
      steps: new Map([['beat', consumer], ['consumer', consumer]]),
      definition: [
        { stepId: 'beat', outputKind: 'beat', chapter: 1, gateAfter: { kind: 'beat', chapter: 1 } },
        { stepId: 'consumer', outputKind: 'prose', chapter: 1, consumes: ['beat'] },
      ],
    })
    expect((await downstream.advance(work.id)).kind).toBe('awaiting-approval')
    expect(consumed).toEqual([])
    const content = { ...beatContent, goal: '作者通过的最终目标' }
    expect((await app.request(`/api/works/${work.id}/artifacts/beat/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content }),
    })).status).toBe(200)
    await downstream.advance(work.id)
    expect(consumed).toEqual([{ beat: content }])
    const poisoned = store.appendArtifact(work.id, 'beat', { invalid: true }, { chapter: 1 })
    store.finalizeArtifact({ workId: work.id, kind: 'beat', chapter: 1, expectedArtifactId: poisoned.id,
      expectedHeadVersion: poisoned.version, content: { invalid: true } })
    expect((await downstream.advance(work.id)).kind).toBe('awaiting-approval')
    expect(consumed).toHaveLength(1)
  })
  it('returns the same safe failure classification and input budget as its command diagnostics', async () => {
    const budget = { limit: 400_000, actualLength: 400_001, systemChars: 1, outlineChars: 200_000, settingChars: 200_000, draftChars: 0, instructionsChars: 0 }
    const first = await ready(async () => { throw new KnownError('input-budget-exceeded', 'input too large', { inputBudget: budget }) })
    const result = advanceOutcomeDtoSchema.parse(await (await first.app.request(`/api/works/${first.work.id}/advance`, { method: 'POST' })).json())
    expect(result).toMatchObject({ code: 'input-budget-exceeded', inputBudget: budget, beatCommand: { failureStage: 'input', writeOutcome: 'not-committed', attemptIds: [] } })
    const second = await ready(async () => { beatContentSchema.parse({}); throw new Error('unreachable') })
    const invalid = await (await second.app.request(`/api/works/${second.work.id}/advance`, { method: 'POST' })).json()
    expect(invalid).toMatchObject({ code: 'llm-invalid-output', beatCommand: { failureStage: 'output' } })
    expect(second.pipeline.failureOf(second.work.id)?.code).toBe('llm-invalid-output')
  })
  it('isolates work and artifact identities across Store lifetimes', () => {
    const first = new InMemoryStore()
    const second = new InMemoryStore()
    const a = first.createWork({ seed: '合成测试' })
    const b = second.createWork({ seed: '合成测试' })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^work-[0-9a-f-]{36}$/)
    const x = first.appendArtifact(a.id, 'beat', beatContent, { chapter: 1 })
    const y = second.appendArtifact(b.id, 'beat', beatContent, { chapter: 1 })
    expect(x.id).not.toBe(y.id)
    expect(() => second.finalizeArtifact({ workId: a.id, kind: 'beat', chapter: 1, expectedArtifactId: x.id, expectedHeadVersion: 1, content: beatContent })).toThrow(/work not found/)
    expect(second.getWork(b.id)!.artifacts[0]).toEqual(y)
  })
  it('rejects old HTTP requests after a Store restart even with only new cards or an empty plan', async () => {
    const first = await ready()
    await first.app.request(`/api/works/${first.work.id}/advance`, { method: 'POST' })
    const oldHead = first.store.getWork(first.work.id)!.artifacts.find(a => a.kind === 'beat')!
    const model = vi.fn(async () => ({ content: beatContent }))
    const second = await ready(model)
    await second.app.request(`/api/works/${second.work.id}/advance`, { method: 'POST' })
    model.mockClear()
    const unchanged = await (await second.app.request(`/api/works/${second.work.id}`)).json()
    for (const operation of ['approve', 'regenerate']) {
      const content = { ...beatContent, writingPlan: operation === 'approve' ? [{ title: '作者新卡', content: '没有旧卡 ID' }] : [] }
      const body = JSON.stringify({ chapter: 1, expectedArtifactId: oldHead.id, expectedHeadVersion: oldHead.version,
        content, ...(operation === 'regenerate' ? { instructions: '' } : {}),
      })
      for (const target of [first.work.id, second.work.id]) {
        const response = await second.app.request(`/api/works/${target}/artifacts/beat/${operation}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        })
        expect(response.status).toBe(target === first.work.id ? 404 : 409)
        expect(await response.json()).toMatchObject({ code: target === first.work.id ? 'work-not-found' : 'version-conflict',
          command: { writeOutcome: 'not-committed', attemptIds: [], failureStage: 'precondition' },
        })
      }
    }
    expect(model).not.toHaveBeenCalled()
    expect(await (await second.app.request(`/api/works/${second.work.id}`)).json()).toEqual(unchanged)
  })
  it('rejects malformed chapter addresses at definition construction', () => {
    const step: ArtifactStep = { id: 'test', inputSchema: z.any(), outputSchema: z.any(), async run() { return { content: {} } } }
    const make = (entry: import('../src/pipeline/pipeline.js').PipelineDefinitionEntry) => new Pipeline({
      store: new InMemoryStore(), steps: new Map([['test', step]]), definition: [entry], resolveConfig: () => ({}),
    })
    expect(() => make({ stepId: 'test', outputKind: 'beat' })).toThrow(/chapter/)
    expect(() => make({ stepId: 'test', outputKind: 'setting', chapter: 1 })).toThrow(/chapter/)
    for (const chapter of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => make({ stepId: 'test', outputKind: 'beat', chapter })).toThrow(/chapter/)
    }
    expect(() => make({ stepId: 'test', outputKind: 'beat', chapter: 1, gateAfter: { kind: 'beat', chapter: 2 } })).toThrow(/gateAfter/)
  })
  it('rejects invalid chapter addresses at the Store boundary without creating a bucket', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'synthetic' })
    for (const chapter of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.appendArtifact(work.id, 'beat', beatContent, { chapter })).toThrow(/chapter/)
    }
    expect(store.getWork(work.id)!.artifacts).toEqual([])
  })
  it('generates exactly chapter one and stops at its author gate', async () => {
    const { app, work } = await ready()
    const response = await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    expect(await response.json()).toMatchObject({
      kind: 'advanced', stepId: 'beat', state: { pendingGate: { kind: 'beat', chapter: 1 } },
      beatCommand: {
        kind: 'execution-result', operation: 'generate-beat', target: { workId: work.id, kind: 'beat', chapter: 1 },
        expectedHead: null, writeOutcome: 'committed', attemptIds: [], executionMode: 'demo',
        resultHead: { version: 1, humanStatus: 'pending' },
      },
    })
    const current = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    expect(current).toMatchObject({ workflowState: 'awaiting-beat-review', allowedActions: ['approve', 'regenerate'] })
    expect(current.artifacts.filter((a: { kind: string }) => a.kind === 'beat')).toEqual([
      expect.objectContaining({ kind: 'beat', chapter: 1, version: 1, humanStatus: 'pending', content: beatContent }),
    ])
    expect(current.artifacts.some((a: { kind: string }) => a.kind === 'prose')).toBe(false)
    expect(await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json()).toMatchObject({ kind: 'awaiting-approval' })
  })
  it('rechecks an invalid approved upstream even when a later Beat is already pending', async () => {
    const { app, work, store } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    store.appendArtifact(work.id, 'outline', { invalid: true })
    store.setStatus(work.id, 'outline', 'approved')
    const view = await (await app.request(`/api/works/${work.id}`)).json()
    expect(view).toMatchObject({ workflowState: 'ready-to-generate', allowedActions: [] })
    expect(await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json()).toMatchObject({
      kind: 'awaiting-approval', state: { stage: 'blocked', pendingGate: { kind: 'outline' } },
    })
  })
  it('approves the edited full content atomically without adding a version or generating prose', async () => {
    const { app, work, store } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    const response = await app.request(`/api/works/${work.id}/artifacts/beat/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version,
        content: { ...beatContent, goal: '作者决定：先保护证人。', writingPlan: [...beatContent.writingPlan, { title: '新安排', content: '保留线索。' }] },
      }),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      artifact: { id: head.id, version: 1, createdAt: head.createdAt, humanStatus: 'approved', content: { goal: '作者决定：先保护证人。' } },
      workflow: { workflowState: 'beat-approved', allowedActions: [], nextStepId: null },
      command: { operation: 'approve-beat', writeOutcome: 'committed', attemptIds: [] }, telemetry: [],
    })
    expect(store.getWork(work.id)!.artifacts.some(a => a.kind === 'prose')).toBe(false)
    const bypass = await app.request(`/api/works/${work.id}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'beat', chapter: 1 }),
    })
    expect(bypass.status).toBe(409)
    expect(await bypass.json()).toMatchObject({ code: 'beat-approval-required' })
    expect(() => store.setStatus(work.id, 'beat', 'pending', { chapter: 1 })).toThrow(/dedicated/)
  })
  it('regenerates from the current unfinished draft into a new pending head and rejects stale retries', async () => {
    const seen: import('../src/pipeline/pipeline.js').PipelineInput[] = []
    const { app, work, store } = await ready(async input => {
      seen.push(input)
      return { content: { ...beatContent, goal: seen.length === 1 ? '初稿' : '新版安排' } }
    })
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const baseline = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    const request = { chapter: 1, expectedArtifactId: baseline.id, expectedHeadVersion: 1,
      content: { title: '', goal: '作者希望保护证人', writingPlan: [], ending: '' }, instructions: '降低开局冲突规模',
    }
    const post = () => app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    })
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      artifact: { version: 2, humanStatus: 'pending', content: { goal: '新版安排' } },
      command: { operation: 'regenerate-beat', writeOutcome: 'committed' }, workflow: { workflowState: 'awaiting-beat-review' },
    })
    expect(seen[1]).toMatchObject({ regeneration: { content: request.content, instructions: request.instructions } })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    expect(head.id).not.toBe(baseline.id)
    const priorIds = new Set(beatContentSchema.parse(baseline.content).writingPlan.map(item => item.itemId))
    expect(beatContentSchema.parse(head.content).writingPlan.every(item => !priorIds.has(item.itemId))).toBe(true)
    expect((await post()).status).toBe(409)
    expect(seen).toHaveLength(2)
  })
  it('does not publish first generation when an earlier approved head changed during the model call', async () => {
    let changeUpstream: () => void = () => {}
    const { app, store, work } = await ready(async () => {
      changeUpstream()
      return { content: beatContent }
    })
    changeUpstream = () => {
      const caption = store.getWork(work.id)!.artifacts.find(a => a.kind === 'caption')!
      store.appendArtifact(work.id, 'caption', caption.content)
      store.setStatus(work.id, 'caption', 'approved')
    }
    const result = await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json()
    expect(result).toMatchObject({ kind: 'failed', code: 'upstream-changed', beatCommand: { writeOutcome: 'not-committed', failureStage: 'commit' } })
    expect(store.getWork(work.id)!.artifacts.some(a => a.kind === 'beat')).toBe(false)
  })
  it('does not turn a committed generation into failure when logging is unavailable', async () => {
    const { app, work } = await ready()
    const log = vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('diagnostics unavailable') })
    try {
      const response = await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
      expect(await response.json()).toMatchObject({ kind: 'advanced', beatCommand: { writeOutcome: 'committed' } })
    } finally { log.mockRestore() }
  })
  it('emits the safe step lineage after committing a generated Beat', async () => {
    const { app, work } = await ready()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
      const records = log.mock.calls.map(([line]) => JSON.parse(String(line)))
      expect(records).toContainEqual(expect.objectContaining({ event: 'pipeline.step', workId: work.id, outputKind: 'beat', chapter: 1, consumed: { outline: 1, setting: 1 } }))
    } finally { log.mockRestore() }
  })
  it('shares the generation lock and lets approval win over a late regeneration', async () => {
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const entered = new Promise<void>(resolve => { started = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const { app, work, store } = await ready(async () => {
      if (++calls === 2) { started!(); await wait }
      return { content: beatContent }
    })
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    const base = { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: 1, content: beatContent }
    const post = (operation: string, body: unknown) => app.request(`/api/works/${work.id}/artifacts/beat/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const regeneration = post('regenerate', { ...base, instructions: '' })
    await entered
    const busy = await post('regenerate', { ...base, instructions: '' })
    expect(busy.status).toBe(409)
    expect(beatCommandErrorSchema.parse(await busy.json())).toMatchObject({ code: 'advance-in-progress', command: { attemptIds: [], writeOutcome: 'not-committed' } })
    expect((await post('approve', { ...base, content: { ...beatContent, goal: '作者最终选择' } })).status).toBe(200)
    release!()
    const late = await regeneration
    expect(late.status).toBe(409)
    expect(await late.json()).toMatchObject({ code: 'version-conflict', command: { failureStage: 'commit', writeOutcome: 'not-committed' } })
    const approved = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    expect(approved.humanStatus).toBe('approved')
    expect(beatContentSchema.parse(approved.content).goal).toBe('作者最终选择')
    expect(calls).toBe(2)
  })
  it('rejects incomplete first-generation output before append', async () => {
    const { app, work, store } = await ready(async () => ({ content: { title: '只有标题' } }))
    const result = await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json()
    expect(result).toMatchObject({ kind: 'failed', code: 'llm-invalid-output', beatCommand: { writeOutcome: 'not-committed', failureStage: 'output' } })
    expect(store.getWork(work.id)!.artifacts.some(a => a.kind === 'beat')).toBe(false)
  })
  it('provides a schema-valid demo generator with fresh card identities for whole regeneration', async () => {
    const { store, work } = await ready()
    const upstream = Object.fromEntries(store.getWork(work.id)!.artifacts.filter(a => a.kind === 'outline' || a.kind === 'setting').map(a => [a.kind, a.content]))
    const step = fakeSteps.createFakeBeatStep()
    const input = { workId: work.id, seed: work.seed, upstream, chapter: 1 }
    const first = beatContentSchema.parse((await step.run(input, {})).content)
    const next = beatContentSchema.parse((await step.run({ ...input, regeneration: { content: first, instructions: '合成修改意见' } }, {})).content)
    expect(first.writingPlan.length).toBeGreaterThan(0)
    expect(first.writingPlan[0]!.itemId).not.toBe(next.writingPlan[0]!.itemId)
    expect(next.goal).toContain('合成修改意见')
  })
  it('validates Beat content in the public WorkView instead of accepting arbitrary JSON', async () => {
    const { app, work } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const view = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    const corrupted = { ...view, artifacts: view.artifacts.map(a => a.kind === 'beat' ? { ...a, content: { title: 'partial' } } : a) }
    expect(workViewSchema.safeParse(corrupted).success).toBe(false)
  })
  it('correlates actual model telemetry with the current Beat request', async () => {
    const { app, work } = await ready(async input => {
      recordTelemetry(input.workId, { stepId: 'beat', attemptId: 'test-beat-attempt', model: 'demo', ok: true, latencyMs: 2,
        promptChars: 20, promptHash: 'safe-hash', systemHash: 'safe-system-hash' })
      return { content: beatContent }
    })
    const result = advanceOutcomeDtoSchema.parse(await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json())
    if (result.kind !== 'advanced' || !result.beatCommand) throw new Error('missing generation observation')
    expect(result).toMatchObject({ beatCommand: { attemptIds: ['test-beat-attempt'] }, telemetry: [{ requestId: result.beatCommand.requestId, attemptId: 'test-beat-attempt' }] })
    const logs = await app.request(`/api/works/${work.id}/telemetry?requestId=${result.beatCommand.requestId}`)
    expect(await logs.json()).toMatchObject({ workId: work.id,
      commands: [{ command: { requestId: result.beatCommand.requestId, writeOutcome: 'committed' }, code: 'ok' }],
      window: { retention: 'process-memory', llm: { capacity: 1000 }, commands: { capacity: 1000 } },
    })
    expect((await app.request(`/api/works/${work.id}/telemetry?unknown=value`)).status).toBe(400)
  })
  it('reports unknown, never not-committed, if an adapter throws after publishing', async () => {
    class AmbiguousStore extends InMemoryStore {
      override finalizeArtifact(input: Parameters<InMemoryStore['finalizeArtifact']>[0]) {
        const result = super.finalizeArtifact(input)
        if (input.kind === 'beat') throw new Error('synthetic post-write failure')
        return result
      }
    }
    const { app, work, store } = await ready(undefined, new AmbiguousStore())
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    const response = await app.request(`/api/works/${work.id}/artifacts/beat/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: 1, content: beatContent }),
    })
    expect(response.status).toBe(500)
    expect(beatCommandErrorSchema.parse(await response.json())).toMatchObject({ command: { writeOutcome: 'unknown', failureStage: 'commit' } })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!.humanStatus).toBe('approved')
  })
  it('rejects malformed requests without business observations and preserves the current head', async () => {
    const { app, work, store } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const before = store.getWork(work.id)
    for (const [body, status] of [['{', 400], [JSON.stringify({ chapter: 2 }), 400], ['x'.repeat(1024 * 1024 + 1), 413]] as const) {
      const response = await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      })
      expect(response.status).toBe(status)
      const failure = beatCommandErrorSchema.parse(await response.json())
      expect(failure.command).toMatchObject({ kind: 'request-rejected', operation: 'regenerate-beat', attemptIds: [], writeOutcome: 'not-committed' })
      expect(failure.command).not.toHaveProperty('target')
    }
    expect(store.getWork(work.id)).toEqual(before)
  })
  it('bounds validation diagnostics and does not expose polluted Beat content in GET', async () => {
    const { app, store, work } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    const response = await app.request(`/api/works/${work.id}/artifacts/beat/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: 1, content: { ...beatContent, writingPlan: Array.from({ length: 10_000 }, () => ({})) } }) })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ issues: [{ path: ['content', 'writingPlan'] }], command: { writeOutcome: 'not-committed' } })
    store.appendArtifact(work.id, 'beat', { poisoned: 'SYNTHETIC_PRIVATE_MARKER' }, { chapter: 1 })
    const invalid = await app.request(`/api/works/${work.id}`)
    expect(invalid.status).toBe(500)
    expect(await invalid.text()).not.toContain('SYNTHETIC_PRIVATE_MARKER')
  })
})
