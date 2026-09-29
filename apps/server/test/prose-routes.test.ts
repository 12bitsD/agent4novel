import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnosticResponseSchema, proseCommandErrorSchema, proseCommandResponseSchema, proseArtifactSchema, recoverProseSubmission, workViewSchema, jsonValueSchema, settingContentSchema, beatContentSchema, advanceOutcomeDtoSchema } from '@agent4novel/contracts'
import { Pipeline, type ArtifactStep } from '../src/pipeline/pipeline.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { KnownError } from '../src/errors.js'
import { createApp } from '../src/app.js'
import { resetTelemetry, recordTelemetry } from '../src/steps/telemetry.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { approveSetting } from '../src/setting-review.js'
import { approveBeat } from '../src/beat-review.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep, createFakeBeatStep } from '../src/steps/fake-step.js'

function emptyWork() {
  const store = new InMemoryStore()
  const work = store.createWork({ seed: '合成素材' })
  const pipeline = new Pipeline({ store, steps: new Map(), definition: [], resolveConfig: () => ({}) })
  return { store, work, app: createApp({ store, pipeline, meta: { demo: true } }) }
}

async function ready(run?: ArtifactStep['run'], store = new InMemoryStore()) {
  const prose: ArtifactStep = {
    id: 'prose', inputSchema: z.any(), outputSchema: z.object({ content: jsonValueSchema }),
    run: run ?? (async () => ({ content: { text: '起初，雾城只有潮声。' } })),
  }
  const pipeline = new Pipeline({
    store, consumeGuards, resolveConfig: () => ({ directionCount: 1 }),
    steps: new Map([
      ['caption', createFakeCaptionStep()], ['creative', createFakeCreativeStep()],
      ['outline', createFakeOutlineStep()], ['setting', createFakeSettingStep()], ['beat', createFakeBeatStep()], ['prose', prose],
    ]),
    definition: [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
      { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
      { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
      { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
      { stepId: 'prose', outputKind: 'prose', chapter: 1, consumes: ['beat', 'setting'], gateAfter: { kind: 'prose', chapter: 1 } },
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
  await pipeline.advance(work.id)
  const beat = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
  await approveBeat(store, work.id, { chapter: 1, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beatContentSchema.parse(beat.content) })
  const app = createApp({ store, pipeline, meta: { demo: true } })
  return { store, pipeline, work, app }
}
const jsonRequest = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const viewOf = async (app: ReturnType<typeof createApp>, workId: string) => workViewSchema.parse(await (await app.request(`/api/works/${workId}`)).json())

afterEach(() => { resetTelemetry(); vi.restoreAllMocks() })

describe('first chapter Prose HTTP commands', () => {
  it('saves an empty pending draft, restores it from GET, and still requires complete text for approval', async () => {
    const { app, work, store } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const before = await viewOf(app, work.id)
    const head = before.artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, expectedHumanStatus: 'pending' }
    const saved = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, content: { text: '' } }))
    expect(saved.status).toBe(200)
    const result = proseCommandResponseSchema.parse(await saved.json())
    expect(result).toMatchObject({ artifact: { version: 2, humanStatus: 'pending', content: { text: '' } },
      command: { operation: 'save-prose', expectedHead: { humanStatus: 'pending' }, writeOutcome: 'committed', attemptIds: [] },
      workflow: { workflowState: 'awaiting-prose-review', allowedActions: ['save-draft', 'approve', 'regenerate'] }, telemetry: [],
    })
    expect(result.artifact.id).not.toBe(head.id)
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(result.artifact)
    expect(store.listWorks()[0]!.chapterCount).toBe(0)
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'beat')).toEqual(before.artifacts.find(a => a.kind === 'beat'))
    const empty = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({ chapter: 1, expectedArtifactId: result.artifact.id, expectedHeadVersion: 2, content: { text: '' } }))
    expect(empty.status).toBe(422)
    const final = { text: '  完成编辑后的真正最终全文。\n\n最后一段。  ' }
    const approved = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({ chapter: 1, expectedArtifactId: result.artifact.id, expectedHeadVersion: 2, content: final }))
    expect(approved.status).toBe(200)
    expect(proseCommandResponseSchema.parse(await approved.json()).artifact).toEqual({ ...result.artifact, content: final, humanStatus: 'approved' })
    expect(store.listWorks()[0]!.chapterCount).toBe(1)
  })
  it('saves edits of an approved chapter as a new approved version and rejects an old pending autosave', async () => {
    const { app, work, store } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version }
    const approved = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({ ...base, content: { text: '已通过全文' } }))
    expect(approved.status).toBe(200)
    const stale = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, expectedHumanStatus: 'pending', content: { text: '迟到的旧编辑' } }))
    expect(stale.status).toBe(409)
    expect(proseCommandErrorSchema.parse(await stale.json())).toMatchObject({ code: 'version-conflict', command: { writeOutcome: 'not-committed', failureStage: 'precondition' } })
    const content = { text: '  阅读模式下进入编辑后的完整修改。\n' }
    const saved = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, expectedHumanStatus: 'approved', content }))
    expect(saved.status).toBe(200)
    const result = proseCommandResponseSchema.parse(await saved.json())
    expect(result).toMatchObject({ artifact: { version: 2, humanStatus: 'approved', content }, workflow: { workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft'] }, command: { expectedHead: { humanStatus: 'approved' }, operation: 'save-prose' } })
    expect(result.artifact.id).not.toBe(head.id)
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(result.artifact)
    expect(store.listWorks()[0]!.chapterCount).toBe(1)
    const empty = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, expectedArtifactId: result.artifact.id, expectedHeadVersion: 2, expectedHumanStatus: 'approved', content: { text: ' \n' } }))
    expect(empty.status).toBe(422)
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(result.artifact)
    expect(await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json()).toMatchObject({ kind: 'complete' })
  })
  it('allows one of two saves of the same head and rejects old approval and rewrite requests without model calls', async () => {
    const model = vi.fn(async () => ({ content: { text: '初稿' } }))
    const { app, work } = await ready(model)
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    model.mockClear()
    const head = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version }
    const saves = await Promise.all(['第一份编辑', '第二份编辑'].map(text => app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, expectedHumanStatus: 'pending', content: { text } }))))
    expect(saves.map(response => response.status).sort()).toEqual([200, 409])
    const result = proseCommandResponseSchema.parse(await saves.find(response => response.status === 200)!.json())
    for (const operation of ['approve', 'regenerate']) {
      const stale = await app.request(`/api/works/${work.id}/artifacts/prose/${operation}`, jsonRequest({ ...base, content: { text: '旧基线全文' }, ...(operation === 'regenerate' ? { instructions: '' } : {}) }))
      expect(stale.status).toBe(409)
      expect(proseCommandErrorSchema.parse(await stale.json())).toMatchObject({ code: 'version-conflict', command: { failureStage: 'precondition', writeOutcome: 'not-committed', attemptIds: [] } })
    }
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(result.artifact)
    expect(model).not.toHaveBeenCalled()
  })
  it('allows an autosave to win over an in-flight rewrite and rejects a stale save after a rewrite wins', async () => {
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const { app, work } = await ready(async input => {
      calls++
      if (calls === 2) { started(); await wait }
      return { content: { text: input.regeneration ? '模型新版' : '初稿' } }
    })
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const head = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '' } }
    const rewriting = app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest({ ...base, instructions: '' }))
    await entered
    const savedResponse = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, expectedHumanStatus: 'pending', content: { text: '  写作期间作者又改过的全文。\n' } }))
    expect(savedResponse.status).toBe(200)
    const saved = proseCommandResponseSchema.parse(await savedResponse.json()).artifact
    release()
    const late = await rewriting
    expect(late.status).toBe(409)
    expect(proseCommandErrorSchema.parse(await late.json())).toMatchObject({ code: 'version-conflict', command: { failureStage: 'commit', writeOutcome: 'not-committed' } })
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(saved)
    const current = { ...base, expectedArtifactId: saved.id, expectedHeadVersion: saved.version }
    const rewritten = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest({ ...current, instructions: '' }))
    expect(rewritten.status).toBe(200)
    const result = proseCommandResponseSchema.parse(await rewritten.json()).artifact
    const staleSave = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...current, expectedHumanStatus: 'pending', content: { text: '旧保存' } }))
    expect(staleSave.status).toBe(409)
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(result)
    expect(calls).toBe(3)
  })
  it.each(['commit', 'response'] as const)('recovers a save after a %s failure by exact readback without a duplicate write', async stage => {
    class SaveFailsStore extends InMemoryStore {
      failNextRead = false
      override getWork(id: string) {
        if (this.failNextRead) { this.failNextRead = false; throw new Error('private-save-response-failure') }
        return super.getWork(id)
      }
      override saveArtifact(input: Parameters<InMemoryStore['saveArtifact']>[0]) {
        const result = super.saveArtifact(input)
        if (stage === 'commit') throw new Error('private-save-write-failure')
        this.failNextRead = true
        return result
      }
    }
    const logs: unknown[] = []
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(value) })
    const { app, work } = await ready(undefined, new SaveFailsStore())
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const baseline = proseArtifactSchema.parse((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose'))
    const request = { chapter: 1 as const, expectedArtifactId: baseline.id, expectedHeadVersion: baseline.version, expectedHumanStatus: 'pending' as const, content: { text: '  private-exact-autosave-text\n\n保留空格。  ' } }
    const response = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest(request))
    expect(response.status).toBe(500)
    const failure = proseCommandErrorSchema.parse(await response.json())
    expect(failure).toMatchObject({ code: 'internal-error', command: { operation: 'save-prose', failureStage: stage, writeOutcome: 'unknown', attemptIds: [] } })
    const workView = await viewOf(app, work.id)
    const current = workView.artifacts.find(a => a.kind === 'prose')!
    expect(current).toMatchObject({ version: baseline.version + 1, humanStatus: 'pending', content: request.content })
    expect(recoverProseSubmission({ baseline, submission: { operation: 'save-prose', request }, hasUnknownWrite: true, response: { status: 500, body: failure }, work: workView, workIsReadback: true })).toMatchObject({ resolution: 'confirmed', artifact: current, hasUnknownWrite: false })
    const retry = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest(request))
    expect(retry.status).toBe(409)
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toEqual(current)
    const diagnostic = diagnosticResponseSchema.parse(await (await app.request(`/api/works/${work.id}/telemetry?requestId=${failure.command.requestId}`)).json())
    expect(diagnostic.commands.at(-1)).toMatchObject({ code: 'internal-error', command: failure.command })
    expect(JSON.stringify({ diagnostic, logs, failure })).not.toMatch(/private-exact-autosave-text|private-save-write-failure|private-save-response-failure/)
  })
  it('rejects malformed requests before execution and retains safe request-scoped diagnostics', async () => {
    const logs: unknown[] = []
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(value) })
    const { app, work } = emptyWork()
    const head = { chapter: 1, expectedArtifactId: 'prose-first', expectedHeadVersion: 1 }
    const cases = [
      { body: '{private-broken-payload', code: 'bad-json', status: 400 },
      { body: JSON.stringify({ ...head, content: { text: 'text' }, unexpected: 'private-extra' }), code: 'invalid-input', status: 400 },
      { body: JSON.stringify({ ...head, chapter: 0, content: { text: 'text' } }), code: 'unsupported-chapter', status: 400 },
      { body: JSON.stringify({ ...head, content: { text: '密'.repeat(400_000) } }), code: 'payload-too-large', status: 413 },
    ]
    for (const operation of ['approve', 'regenerate', 'save']) {
      for (const candidate of cases) {
        const response = await app.request(`/api/works/${work.id}/artifacts/prose/${operation}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: candidate.body,
        })
        expect(response.status).toBe(candidate.status)
        const failure = proseCommandErrorSchema.parse(await response.json())
        expect(failure).toMatchObject({ code: candidate.code, retryable: false, command: {
          kind: 'request-rejected', operation: `${operation}-prose`, executionMode: 'demo', writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [],
        } })
        const diagnostic = diagnosticResponseSchema.parse(await (await app.request(`/api/works/${work.id}/telemetry?requestId=${failure.command.requestId}`)).json())
        expect(diagnostic.commands).toEqual([expect.objectContaining({ command: failure.command, code: candidate.code })])
        expect(diagnostic.telemetry).toEqual([])
      }
    }
    expect(logs.map(log => JSON.parse(String(log)))).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'prose.command' })]))
    expect(JSON.stringify(logs)).not.toMatch(/private-broken-payload|private-extra|密/)
  })
  it('requires a save status baseline and validates only its draft content before writing', async () => {
    const { app, work } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const before = await viewOf(app, work.id)
    const head = before.artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '正文' } }
    for (const invalid of [base, { ...base, expectedHumanStatus: 'unknown' }, { ...base, expectedHumanStatus: 'pending', instructions: '不接受保存意见' }]) {
      const response = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest(invalid))
      expect(response.status).toBe(400)
      expect(proseCommandErrorSchema.parse(await response.json())).toMatchObject({ command: { kind: 'request-rejected', operation: 'save-prose', writeOutcome: 'not-committed' } })
    }
    for (const content of [{ text: '文'.repeat(100001) }, { text: '正文', extra: 'private' }, { text: 42 }]) {
      const response = await app.request(`/api/works/${work.id}/artifacts/prose/save`, jsonRequest({ ...base, expectedHumanStatus: 'pending', content }))
      expect(response.status).toBe(422)
      expect(proseCommandErrorSchema.parse(await response.json())).toMatchObject({ command: { operation: 'save-prose', expectedHead: { humanStatus: 'pending' }, failureStage: 'input', writeOutcome: 'not-committed', attemptIds: [] } })
    }
    expect(await viewOf(app, work.id)).toEqual(before)
  })
  it('reads the pending gate and approves the author exact text on the same chapter identity', async () => {
    const { app, work } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const before = await viewOf(app, work.id)
    expect(before).toMatchObject({ workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['save-draft', 'approve', 'regenerate'] })
    const prose = before.artifacts.find(a => a.kind === 'prose')!
    const beat = before.artifacts.find(a => a.kind === 'beat')!
    const content = { text: '  作者修改后的开头。\n\n下一段保留空行。\n' }
    const response = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({
      chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: prose.version, content,
    }))
    expect(response.status).toBe(200)
    const result = proseCommandResponseSchema.parse(await response.json())
    expect(result.artifact).toEqual({ ...prose, content, humanStatus: 'approved' })
    expect(result).toMatchObject({ command: { operation: 'approve-prose', writeOutcome: 'committed', attemptIds: [] },
      workflow: { workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft'] }, telemetry: [],
    })
    const after = await viewOf(app, work.id)
    expect(after.artifacts.find(a => a.kind === 'beat')).toEqual(beat)
    expect(after.artifacts.find(a => a.kind === 'prose')).toEqual(result.artifact)
    expect(after.workflowState).toBe('prose-approved')
  })

  it.each([
    { name: 'unknown error', cause: new Error('private-response-failure') },
    { name: 'known upstream error', cause: new KnownError('upstream-changed', 'private-response-failure', { retryable: true }) },
    { name: 'schema error', cause: new z.ZodError([{ code: 'custom', path: ['private'], message: 'private-response-failure' }]) },
  ])('reports unknown for $name after approval and preserves the committed exact text', async ({ cause }) => {
    class ReadbackFailsStore extends InMemoryStore {
      failNextRead = false
      override getWork(id: string) {
        if (this.failNextRead) { this.failNextRead = false; throw cause }
        return super.getWork(id)
      }
      override finalizeArtifact(input: Parameters<InMemoryStore['finalizeArtifact']>[0]) {
        const artifact = super.finalizeArtifact(input)
        if (input.kind === 'prose') this.failNextRead = true
        return artifact
      }
    }
    const { app, work } = await ready(undefined, new ReadbackFailsStore())
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const prose = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    const content = { text: '  回复丢失前已经通过的正文。\n' }
    const response = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({
      chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: prose.version, content,
    }))
    expect(response.status).toBe(500)
    const failure = proseCommandErrorSchema.parse(await response.json())
    expect(failure).toMatchObject({ code: 'internal-error', command: { operation: 'approve-prose', writeOutcome: 'unknown', failureStage: 'response', attemptIds: [] } })
    expect(JSON.stringify(failure)).not.toContain('private-response-failure')
    const after = await viewOf(app, work.id)
    expect(after.artifacts.find(a => a.kind === 'prose')).toEqual({ ...prose, content, humanStatus: 'approved' })
    const diagnostic = diagnosticResponseSchema.parse(await (await app.request(`/api/works/${work.id}/telemetry?requestId=${failure.command.requestId}`)).json())
    expect(diagnostic.commands.at(-1)).toMatchObject({ code: 'internal-error', command: failure.command })
  })

  it('rewrites the current edited text with request-local attempts and exposes no submitted content in diagnostics', async () => {
    const logs: unknown[] = []
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(value) })
    let attempt = 0
    const { app, work } = await ready(async input => {
      recordTelemetry(input.workId, { stepId: 'prose', attemptId: `prose-attempt-${++attempt}`, model: 'fake', ok: true,
        latencyMs: 1, promptChars: 40, promptHash: 'hash', systemHash: 'hash' })
      return { content: { text: input.regeneration ? `${(input.regeneration.content as { text: string }).text}\n${input.regeneration.instructions}` : '第一稿' } }
    })
    const generated = advanceOutcomeDtoSchema.parse(await (await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })).json())
    expect(generated).toMatchObject({ kind: 'advanced', stepId: 'prose', proseCommand: { operation: 'generate-prose', writeOutcome: 'committed', attemptIds: ['prose-attempt-1'] },
      telemetry: [{ stepId: 'prose', attemptId: 'prose-attempt-1' }],
    })
    const prose = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    const request = { chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: prose.version,
      content: { text: 'private-current-text' }, instructions: 'private-rewrite-instructions',
    }
    const response = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest(request))
    expect(response.status).toBe(200)
    const result = proseCommandResponseSchema.parse(await response.json())
    expect(result.artifact).toMatchObject({ version: prose.version + 1, humanStatus: 'pending', content: { text: 'private-current-text\nprivate-rewrite-instructions' } })
    expect(result.artifact.id).not.toBe(prose.id)
    expect(result).toMatchObject({ command: { operation: 'regenerate-prose', writeOutcome: 'committed', attemptIds: ['prose-attempt-2'] }, workflow: { workflowState: 'awaiting-prose-review' } })
    expect(result.telemetry).toEqual([expect.objectContaining({ requestId: result.command.requestId, attemptId: 'prose-attempt-2' })])
    const diagnostic = diagnosticResponseSchema.parse(await (await app.request(`/api/works/${work.id}/telemetry?requestId=${result.command.requestId}&attemptId=prose-attempt-2`)).json())
    expect(diagnostic.commands).toEqual([expect.objectContaining({ command: result.command, code: 'ok' })])
    expect(diagnostic.telemetry).toEqual(result.telemetry)
    const stale = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest(request))
    expect(stale.status).toBe(409)
    expect(proseCommandErrorSchema.parse(await stale.json())).toMatchObject({ code: 'version-conflict', command: { writeOutcome: 'not-committed', failureStage: 'precondition', attemptIds: [] } })
    expect(attempt).toBe(2)
    expect(JSON.stringify({ diagnostic, logs })).not.toMatch(/private-current-text|private-rewrite-instructions/)
  })
  it('rejects invalid content and generic approval without changing the pending chapter', async () => {
    const { app, work } = await ready()
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const before = await viewOf(app, work.id)
    const prose = before.artifacts.find(a => a.kind === 'prose')!
    const head = { chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: prose.version }
    for (const content of [{ text: '  \n\t' }, { text: 'a'.repeat(100_001) }, { text: 'valid', hidden: 'private-property' }]) {
      const response = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({ ...head, content }))
      expect(response.status).toBe(422)
      const failure = proseCommandErrorSchema.parse(await response.json())
      expect(failure).toMatchObject({ code: 'invalid-content', command: { failureStage: 'input', writeOutcome: 'not-committed', attemptIds: [] } })
      expect(failure.issues?.length).toBeGreaterThan(0)
      expect(JSON.stringify(failure)).not.toContain('private-property')
    }
    const tooLong = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest({ ...head, content: { text: '' }, instructions: 'x'.repeat(10_001) }))
    expect(tooLong.status).toBe(422)
    expect(proseCommandErrorSchema.parse(await tooLong.json())).toMatchObject({ code: 'invalid-content', issues: [expect.objectContaining({ path: ['instructions'] })] })
    const generic = await app.request(`/api/works/${work.id}/approve`, jsonRequest({ kind: 'prose', chapter: 1 }))
    expect(generic.status).toBe(409)
    expect(await generic.json()).toMatchObject({ code: 'prose-approval-required' })
    expect(await viewOf(app, work.id)).toEqual(before)
  })
  it('uses 404 for missing targets and 409 for stale identities, earlier gates, and completed prose', async () => {
    const { app, work, store } = await ready()
    const request = { chapter: 1, expectedArtifactId: 'missing', expectedHeadVersion: 1, content: { text: '正文' } }
    for (const target of [work.id, 'work-missing']) {
      const response = await app.request(`/api/works/${target}/artifacts/prose/approve`, jsonRequest(request))
      expect(response.status).toBe(404)
      expect(proseCommandErrorSchema.parse(await response.json())).toMatchObject({ code: target === work.id ? 'artifact-not-found' : 'work-not-found', command: { failureStage: 'precondition', writeOutcome: 'not-committed' } })
    }
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const prose = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    const stale = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest(request))
    expect(stale.status).toBe(409)
    expect(proseCommandErrorSchema.parse(await stale.json())).toMatchObject({ code: 'version-conflict' })
    const valid = { ...request, expectedArtifactId: prose.id }
    expect((await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest(valid))).status).toBe(200)
    for (const operation of ['approve', 'regenerate']) {
      const response = await app.request(`/api/works/${work.id}/artifacts/prose/${operation}`, jsonRequest({ ...valid, ...(operation === 'regenerate' ? { instructions: '' } : {}) }))
      expect(response.status).toBe(409)
      expect(proseCommandErrorSchema.parse(await response.json())).toMatchObject({ code: 'artifact-already-approved' })
    }
    const pending = store.appendArtifact(work.id, 'prose', { text: 'new pending' }, { chapter: 1 })
    const beat = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')!
    store.appendArtifact(work.id, 'beat', beat.content, { chapter: 1 })
    const blocked = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, jsonRequest({ ...valid, expectedArtifactId: pending.id, expectedHeadVersion: pending.version }))
    expect(blocked.status).toBe(409)
    expect(proseCommandErrorSchema.parse(await blocked.json())).toMatchObject({ code: 'prose-gate-not-ready' })
  })

  it.each(['generate', 'regenerate'] as const)('reports unknown for %s when response readback fails after append', async operation => {
    class ReadbackFailsStore extends InMemoryStore {
      failAppendRead = false
      failNextRead = false
      override getWork(id: string) {
        if (this.failNextRead) { this.failNextRead = false; throw new Error('private-append-response-failure') }
        return super.getWork(id)
      }
      override appendArtifact(...args: Parameters<InMemoryStore['appendArtifact']>) {
        const artifact = super.appendArtifact(...args)
        if (args[1] === 'prose' && this.failAppendRead) this.failNextRead = true
        return artifact
      }
    }
    const store = new ReadbackFailsStore()
    let attempt = 0
    const { app, work } = await ready(async input => {
      recordTelemetry(input.workId, { stepId: 'prose', attemptId: `response-attempt-${++attempt}`, model: 'fake', ok: true,
        latencyMs: 1, promptChars: 10, promptHash: 'hash', systemHash: 'hash' })
      return { content: { text: '  已落库的生成正文。\n' } }
    }, store)
    let baseline: Awaited<ReturnType<typeof viewOf>>['artifacts'][number] | undefined
    if (operation === 'regenerate') {
      await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
      baseline = (await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')!
    }
    store.failAppendRead = true
    const response = operation === 'generate'
      ? await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
      : await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest({ chapter: 1,
        expectedArtifactId: baseline!.id, expectedHeadVersion: baseline!.version, content: { text: 'edited' }, instructions: 'rewrite',
      }))
    expect(response.status).toBe(500)
    const failure = proseCommandErrorSchema.parse(await response.json())
    expect(failure).toMatchObject({ code: 'internal-error', retryable: false, command: { operation: `${operation}-prose`, writeOutcome: 'unknown', failureStage: 'response', attemptIds: [`response-attempt-${attempt}`] },
      telemetry: [expect.objectContaining({ requestId: failure.command.requestId, attemptId: `response-attempt-${attempt}` })],
    })
    expect(JSON.stringify(failure)).not.toContain('private-append-response-failure')
    expect((await viewOf(app, work.id)).artifacts.find(a => a.kind === 'prose')).toMatchObject({ version: operation === 'generate' ? 1 : 2, humanStatus: 'pending', content: { text: '  已落库的生成正文。\n' } })
    const diagnostic = diagnosticResponseSchema.parse(await (await app.request(`/api/works/${work.id}/telemetry?requestId=${failure.command.requestId}`)).json())
    expect(diagnostic.commands.at(-1)).toMatchObject({ code: 'internal-error', command: failure.command })
  })

  it.each([
    { code: 'llm-invalid-output', status: 502, stage: 'output' },
    { code: 'llm-unavailable', status: 503, stage: 'model' },
    { code: 'llm-timeout', status: 504, stage: 'model' },
    { code: 'input-budget-exceeded', status: 422, stage: 'input' },
  ] as const)('returns safe $status diagnostics for rewrite $code and preserves the previous prose', async ({ code, status, stage }) => {
    const budget = { limit: 400_000, actualLength: 400_001, systemChars: 1, beatChars: 200_000, settingChars: 200_000, draftChars: 0, instructionsChars: 0 }
    const { app, work } = await ready(async input => {
      if (input.regeneration) throw new KnownError(code, 'private-provider-response', { retryable: false,
        ...(code === 'input-budget-exceeded' ? { inputBudget: budget } : {}),
      })
      return { content: { text: '原有正文' } }
    })
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    const before = await viewOf(app, work.id)
    const prose = before.artifacts.find(a => a.kind === 'prose')!
    const response = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, jsonRequest({ chapter: 1,
      expectedArtifactId: prose.id, expectedHeadVersion: prose.version, content: { text: 'edited' }, instructions: 'opinion',
    }))
    expect(response.status).toBe(status)
    const failure = proseCommandErrorSchema.parse(await response.json())
    expect(failure).toMatchObject({ code, command: { operation: 'regenerate-prose', writeOutcome: 'not-committed', failureStage: stage } })
    if (code === 'input-budget-exceeded') expect(failure.inputBudget).toEqual(budget)
    expect(JSON.stringify(failure)).not.toContain('private-provider-response')
    expect(await viewOf(app, work.id)).toEqual(before)
    const diagnostic = diagnosticResponseSchema.parse(await (await app.request(`/api/works/${work.id}/telemetry?requestId=${failure.command.requestId}`)).json())
    expect(diagnostic.commands).toEqual([expect.objectContaining({ code, command: failure.command })])
  })

})
