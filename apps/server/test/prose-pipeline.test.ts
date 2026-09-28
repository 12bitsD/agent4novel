import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { beatContentSchema, jsonValueSchema, settingContentSchema, type JsonValue } from '@agent4novel/contracts'
import { Pipeline, type ArtifactStep, type PipelineInput } from '../src/pipeline/pipeline.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { approveSetting } from '../src/setting-review.js'
import { approveBeat } from '../src/beat-review.js'
import { approveProse } from '../src/prose-review.js'
import { KnownError } from '../src/errors.js'
import { createApp } from '../src/app.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep, createFakeBeatStep } from '../src/steps/fake-step.js'

async function ready(run?: ArtifactStep['run'], store = new InMemoryStore()) {
  const prose: ArtifactStep = {
    id: 'prose', inputSchema: z.any(), outputSchema: z.object({ content: jsonValueSchema }),
    run: run ?? (async () => ({ content: { text: '第一章的完整合成正文。' } })),
  }
  const pipeline = new Pipeline({ store, consumeGuards, resolveConfig: () => ({ directionCount: 1 }),
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
  return { store, pipeline, work }
}

async function approveCurrentBeat(store: InMemoryStore, workId: string) {
  const head = store.getWork(workId)!.artifacts.find(a => a.kind === 'beat')!
  const content = { ...beatContentSchema.parse(head.content), goal: '作者最终通过的目标', ending: '作者指定的落点' }
  return (await approveBeat(store, workId, { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content })).artifact
}

describe('first chapter Prose pipeline', () => {
  it('allows a test-only downstream consumer to read only the exact HTTP-approved Prose, never pending or invalid content', async () => {
    const { store, pipeline, work } = await ready()
    const beat = await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    const seen: unknown[] = []
    const consumer: ArtifactStep = { id: 'test-only-consumer', inputSchema: z.any(), outputSchema: z.object({ content: jsonValueSchema }),
      async run(input) { seen.push(input.upstream); return { content: beat.content } },
    }
    // A synthetic receipt uses the unused beat#2 address in this test-only definition.
    // Production has six steps and ends at prose#1; this consumer does not write fiction.
    const downstream = new Pipeline({ store, consumeGuards, resolveConfig: () => ({}), steps: new Map([['prose', consumer], ['test-only-consumer', consumer]]),
      definition: [
        { stepId: 'prose', outputKind: 'prose', chapter: 1, gateAfter: { kind: 'prose', chapter: 1 } },
        { stepId: 'test-only-consumer', outputKind: 'beat', chapter: 2, consumes: ['prose'], gateAfter: { kind: 'beat', chapter: 2 } },
      ],
    })
    expect((await downstream.advance(work.id)).kind).toBe('awaiting-approval')
    expect(seen).toEqual([])
    const content = { text: ' \n  这是作者最终通过的正文。\n\n末段与空白必须逐字符保留。  \n' }
    const app = createApp({ store, pipeline, meta: { demo: true } })
    const approved = await app.request(`/api/works/${work.id}/artifacts/prose/approve`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content }),
    })
    expect(approved.status).toBe(200)
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'complete' })
    expect(store.getWork(work.id)!.artifacts.some(a => a.chapter === 2)).toBe(false)
    expect(await downstream.advance(work.id)).toMatchObject({ kind: 'advanced', stepId: 'test-only-consumer' })
    expect(seen).toEqual([{ prose: content }])
    const pending = store.appendArtifact(work.id, 'prose', { text: '后来的待审正文' }, { chapter: 1 })
    expect((await downstream.advance(work.id)).kind).toBe('awaiting-approval')
    store.finalizeArtifact({ workId: work.id, kind: 'prose', chapter: 1, expectedArtifactId: pending.id, expectedHeadVersion: pending.version, content: { text: '' } })
    expect(await downstream.advance(work.id)).toMatchObject({ kind: 'awaiting-approval', state: { stage: 'blocked', pendingGate: { kind: 'prose', chapter: 1 } } })
    expect(seen).toHaveLength(1)
  })
  it('finalizes exact author text on the same identity and forbids generic status changes', async () => {
    const { store, pipeline, work } = await ready()
    const beat = await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    expect(() => pipeline.approve(work.id, 'prose', 1)).toThrow(/full-content/)
    expect(() => store.setStatus(work.id, 'prose', 'approved', { chapter: 1 })).toThrow(/dedicated/)
    const { approveProse } = await import('../src/prose-review.js')
    const content = { text: ' \n  作者修改的首段。\n\n终段保留两个空格。  \n' }
    const result = await approveProse(store, work.id, { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content })
    expect(result).toMatchObject({ artifact: { ...head, content, humanStatus: 'approved' },
      command: { operation: 'approve-prose', writeOutcome: 'committed', attemptIds: [] },
    })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')).toEqual(beat)
    expect(store.listWorks()[0]!.chapterCount).toBe(1)
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'complete', state: { nextStepId: null } })
    expect(store.getWork(work.id)!.artifacts.filter(a => a.kind === 'prose')).toHaveLength(1)
    await expect(approveProse(store, work.id, { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content })).rejects.toMatchObject({
      cause: { code: 'artifact-already-approved' }, command: { writeOutcome: 'not-committed' },
    })
  })
  it('rewrites current edited text and instructions into a new pending head; stale retries never call the model', async () => {
    const seen: PipelineInput[] = []
    const { store, pipeline, work } = await ready(async input => {
      seen.push(input)
      return { content: { text: seen.length === 1 ? '初稿。' : '新正文。' } }
    })
    const beat = await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    const request = { chapter: 1 as const, expectedArtifactId: head.id, expectedHeadVersion: head.version,
      content: { text: '  作者目前正在编辑的文本。\n' }, instructions: '让结尾更克制' }
    const result = await pipeline.regenerateProse(work.id, request)
    expect(result).toMatchObject({ artifact: { version: 2, humanStatus: 'pending', content: { text: '新正文。' } },
      command: { operation: 'regenerate-prose', writeOutcome: 'committed' },
    })
    expect(result.artifact.id).not.toBe(head.id)
    expect(seen[1]).toMatchObject({ regeneration: { content: request.content, instructions: request.instructions } })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')).toEqual(beat)
    expect(store.listWorks()[0]!.chapterCount).toBe(0)
    await expect(pipeline.regenerateProse(work.id, request)).rejects.toMatchObject({ cause: { code: 'version-conflict' }, command: { failureStage: 'precondition', writeOutcome: 'not-committed' } })
    expect(seen).toHaveLength(2)
  })
  it('blocks pending Beat, consumes author-final Beat and Setting, and stops at Prose pending without counting a completed chapter', async () => {
    const seen: PipelineInput[] = []
    const { store, pipeline, work } = await ready(async input => {
      seen.push(input)
      return { content: { text: '  第一段。\n\n第二段。  ' } }
    })
    expect((await pipeline.advance(work.id)).kind).toBe('awaiting-approval')
    expect(seen).toEqual([])
    const beat = await approveCurrentBeat(store, work.id)
    const setting = store.getWork(work.id)!.artifacts.find(a => a.kind === 'setting')!
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'advanced', stepId: 'prose',
      state: { stage: 'awaiting-approval', pendingGate: { kind: 'prose', chapter: 1 } },
      proseCommand: { operation: 'generate-prose', expectedHead: null, writeOutcome: 'committed', resultHead: { version: 1, humanStatus: 'pending' } },
    })
    expect(seen).toEqual([expect.objectContaining({ chapter: 1, upstream: { beat: beat.content, setting: setting.content } })])
    expect(store.listWorks()[0]!.chapterCount).toBe(0)
    expect(store.getWork(work.id)!.artifacts.filter(a => a.kind === 'prose')).toEqual([
      expect.objectContaining({ chapter: 1, version: 1, humanStatus: 'pending', content: { text: '  第一段。\n\n第二段。  ' } }),
    ])
    expect((await pipeline.advance(work.id)).kind).toBe('awaiting-approval')
    expect(seen).toHaveLength(1)
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat')).toEqual(beat)
  })
  it('discards first generation when any earlier approved head changed while the model ran', async () => {
    let change = () => {}
    const { store, pipeline, work } = await ready(async () => { change(); return { content: { text: '过时正文' } } })
    await approveCurrentBeat(store, work.id)
    change = () => {
      const caption = store.getWork(work.id)!.artifacts.find(a => a.kind === 'caption')!
      store.appendArtifact(work.id, 'caption', caption.content)
      store.setStatus(work.id, 'caption', 'approved')
    }
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'failed', code: 'upstream-changed',
      proseCommand: { writeOutcome: 'not-committed', failureStage: 'commit' },
    })
    expect(store.getWork(work.id)!.artifacts.some(a => a.kind === 'prose')).toBe(false)
  })
  it('shares the generation lock with advance and Beat rewrite, and lets author approval defeat a late Prose rewrite', async () => {
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const { store, pipeline, work } = await ready(async () => {
      if (++calls === 2) { started(); await wait }
      return { content: { text: '模型全文。' } }
    })
    const beat = await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1 as const, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '' } }
    const pending = pipeline.regenerateProse(work.id, { ...base, instructions: '作者已经清空当前草稿，重新组织开场。' })
    await entered
    await expect(pipeline.advance(work.id)).rejects.toMatchObject({ code: 'advance-in-progress' })
    await expect(pipeline.regenerateProse(work.id, { ...base, instructions: '' })).rejects.toMatchObject({ cause: { code: 'advance-in-progress' }, command: { writeOutcome: 'not-committed', attemptIds: [] } })
    await expect(pipeline.regenerateBeat(work.id, { chapter: 1, expectedArtifactId: beat.id, expectedHeadVersion: beat.version,
      content: beatContentSchema.parse(beat.content), instructions: '' })).rejects.toMatchObject({ cause: { code: 'advance-in-progress' } })
    const content = { text: '  作者最终全文。\n\n保留段落。  ' }
    await approveProse(store, work.id, { ...base, content })
    release()
    await expect(pending).rejects.toMatchObject({ cause: { code: 'version-conflict' }, command: { writeOutcome: 'not-committed', failureStage: 'commit' } })
    expect(calls).toBe(2)
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toEqual({ ...head, humanStatus: 'approved', content })
  })
  it('rejects approval when a competing rewrite has already won', async () => {
    const { store, pipeline, work } = await ready()
    await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1 as const, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '冻结全文' } }
    const result = await pipeline.regenerateProse(work.id, { ...base, instructions: '' })
    await expect(approveProse(store, work.id, base)).rejects.toMatchObject({ cause: { code: 'version-conflict' }, command: { writeOutcome: 'not-committed', failureStage: 'precondition' } })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toEqual(result.artifact)
  })
  it.each(['caption', 'creative', 'outline', 'setting', 'beat'] as const)('discards rewrite if the approved %s changes during generation', async kind => {
    let change = () => {}
    const { store, pipeline, work } = await ready(async () => { change(); return { content: { text: '当前模型正文。' } } })
    await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    change = () => {
      const upstream = store.getWork(work.id)!.artifacts.find(a => a.kind === kind)!
      const updated = store.appendArtifact(work.id, kind, upstream.content, { chapter: upstream.chapter })
      store.finalizeArtifact({ workId: work.id, kind, chapter: upstream.chapter, expectedArtifactId: updated.id, expectedHeadVersion: updated.version, content: updated.content })
    }
    await expect(pipeline.regenerateProse(work.id, { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '' }, instructions: '' })).rejects.toMatchObject({
      cause: { code: 'upstream-changed' }, command: { failureStage: 'commit', writeOutcome: 'not-committed' },
    })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toEqual(head)
  })
  it.each<JsonValue>([{ text: '  \n ' }, { text: 'x'.repeat(100001) }, { text: '正文', hidden: 'extra' }])('does not append invalid initial or regenerated output %#', async content => {
    let invalid = true
    const { store, pipeline, work } = await ready(async () => ({ content: invalid ? content : { text: '初稿' } }))
    await approveCurrentBeat(store, work.id)
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'failed', code: 'llm-invalid-output', proseCommand: { failureStage: 'output', writeOutcome: 'not-committed' } })
    expect(store.getWork(work.id)!.artifacts.some(a => a.kind === 'prose')).toBe(false)
    invalid = false
    await pipeline.advance(work.id)
    invalid = true
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    await expect(pipeline.regenerateProse(work.id, { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '' }, instructions: '' })).rejects.toMatchObject({
      command: { failureStage: 'output', writeOutcome: 'not-committed' },
    })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toEqual(head)
  })
  it('retains the pending head on model failure and refuses to rewrite an approved head', async () => {
    const model = vi.fn(async () => ({ content: { text: '初稿' } }))
    const { store, pipeline, work } = await ready(model)
    await approveCurrentBeat(store, work.id)
    await pipeline.advance(work.id)
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    const base = { chapter: 1 as const, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '全文' } }
    model.mockRejectedValueOnce(new KnownError('llm-timeout', 'safe timeout', { retryable: true }))
    await expect(pipeline.regenerateProse(work.id, { ...base, instructions: '保留' })).rejects.toMatchObject({ cause: { code: 'llm-timeout' }, command: { failureStage: 'model', writeOutcome: 'not-committed' } })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toEqual(head)
    await approveProse(store, work.id, base)
    model.mockClear()
    await expect(pipeline.regenerateProse(work.id, { ...base, instructions: '' })).rejects.toMatchObject({ cause: { code: 'artifact-already-approved' }, command: { failureStage: 'precondition' } })
    expect(model).not.toHaveBeenCalled()
  })
  it('reports unknown if a Store adapter writes then throws, for generation, rewrite and approval', async () => {
    class AmbiguousStore extends InMemoryStore {
      failAppend = false
      failFinalize = false
      override appendArtifact(...input: Parameters<InMemoryStore['appendArtifact']>) {
        const result = super.appendArtifact(...input)
        if (input[1] === 'prose' && this.failAppend) throw new Error('synthetic post-write failure')
        return result
      }
      override finalizeArtifact(input: Parameters<InMemoryStore['finalizeArtifact']>[0]) {
        const result = super.finalizeArtifact(input)
        if (input.kind === 'prose' && this.failFinalize) throw new Error('synthetic post-write failure')
        return result
      }
    }
    const store = new AmbiguousStore()
    const { pipeline, work } = await ready(undefined, store)
    await approveCurrentBeat(store, work.id)
    store.failAppend = true
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'failed', proseCommand: { writeOutcome: 'unknown', failureStage: 'commit' } })
    const head = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    expect(head.version).toBe(1)
    await expect(pipeline.regenerateProse(work.id, { chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: head.version, content: { text: '' }, instructions: '' })).rejects.toMatchObject({ command: { writeOutcome: 'unknown', failureStage: 'commit' } })
    const next = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')!
    expect(next.version).toBe(2)
    store.failFinalize = true
    await expect(approveProse(store, work.id, { chapter: 1, expectedArtifactId: next.id, expectedHeadVersion: next.version, content: { text: '  人工全文。\n' } })).rejects.toMatchObject({ command: { writeOutcome: 'unknown', failureStage: 'commit' } })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toMatchObject({ humanStatus: 'approved', content: { text: '  人工全文。\n' } })
  })
  it('reports unknown when generation committed but constructing its workflow response fails', async () => {
    class ResponseFailureStore extends InMemoryStore {
      failRead = false
      override appendArtifact(...input: Parameters<InMemoryStore['appendArtifact']>) {
        const result = super.appendArtifact(...input)
        if (input[1] === 'prose') this.failRead = true
        return result
      }
      override getWork(id: string) {
        if (this.failRead) { this.failRead = false; throw new Error('synthetic readback failure') }
        return super.getWork(id)
      }
    }
    const store = new ResponseFailureStore()
    const { pipeline, work } = await ready(undefined, store)
    await approveCurrentBeat(store, work.id)
    await expect(pipeline.advance(work.id)).rejects.toMatchObject({ command: { operation: 'generate-prose', failureStage: 'response', writeOutcome: 'unknown' } })
    expect(store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toMatchObject({ version: 1, humanStatus: 'pending' })
  })
})
