import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { beatContentSchema, beatArtifactSchema, beatCommandResponseSchema, jsonValueSchema, proseContentSchema, proseArtifactSchema, proseCommandResponseSchema, settingContentSchema, workViewSchema, advanceOutcomeDtoSchema } from '@agent4novel/contracts'
import { Pipeline, type ArtifactStep, type PipelineInput } from '../src/pipeline/pipeline.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { approveSetting } from '../src/setting-review.js'
import { approveBeat } from '../src/beat-review.js'
import { approveProse, saveProse } from '../src/prose-review.js'
import { createApp } from '../src/app.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep } from '../src/steps/fake-step.js'

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function ready(onRun?: (input: PipelineInput, kind: string) => Promise<void>, store = new InMemoryStore()) {
  const seen: Array<{ kind: string; input: PipelineInput }> = []
  const step = (id: string): ArtifactStep => ({ id, inputSchema: z.any(), outputSchema: z.object({ content: jsonValueSchema }),
    async run(input): Promise<{ content: import('@agent4novel/contracts').JsonValue }> {
      seen.push({ kind: id, input })
      await onRun?.(input, id)
      return { content: id === 'prose' ? { text: `第${input.chapter}章正文。` } : { title: `章${input.chapter}`, goal: '推进故事', writingPlan: [{ itemId: `plan-${input.chapter}`, title: '相遇', content: '人物相遇' }], ending: '翌日继续' } }
    },
  })
  const pipeline = new Pipeline({ store, consumeGuards, repeatChapters: true, resolveConfig: () => ({ directionCount: 1 }), steps: new Map([
    ['caption', createFakeCaptionStep()], ['creative', createFakeCreativeStep()], ['outline', createFakeOutlineStep()], ['setting', createFakeSettingStep()], ['beat', step('beat')], ['prose', step('prose')],
  ]), definition: [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
    { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
    { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
    { stepId: 'prose', outputKind: 'prose', chapter: 1, consumes: ['beat', 'setting'], gateAfter: { kind: 'prose', chapter: 1 } },
  ] })
  const work = store.createWork({ seed: '追寻失踪名字' })
  const head = (kind: string, chapter?: number) => store.getWork(work.id)!.artifacts.find(a => a.kind === kind && a.chapter === chapter)!
  const approveChapter = async (chapter: number) => {
    const beat = head('beat', chapter)
    await approveBeat(store, work.id, { chapter, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beatContentSchema.parse(beat.content) })
    await pipeline.advance(work.id)
    const prose = head('prose', chapter)
    await approveProse(store, work.id, { chapter, expectedArtifactId: prose.id, expectedHeadVersion: prose.version, content: proseContentSchema.parse(prose.content) })
  }
  await pipeline.advance(work.id); pipeline.approve(work.id, 'creative')
  await pipeline.advance(work.id); pipeline.approve(work.id, 'outline')
  await pipeline.advance(work.id)
  const setting = head('setting')
  approveSetting(store, work.id, { expectedHeadVersion: setting.version, content: settingContentSchema.parse(setting.content) })
  await pipeline.advance(work.id)
  await approveChapter(1)
  const app = createApp({ store, pipeline, meta: { demo: true } })
  const start = (chapter: number) => { const previous = head('prose', chapter - 1); return { chapter, expectedPreviousProseId: previous.id, expectedPreviousProseVersion: previous.version } }
  return { store, work, head, pipeline, seen, app, start, approveChapter }
}

describe('explicit chapter continuation', () => {
  it('stops after each approval, explicitly starts chapter two with latest approved context, and replays never skip chapters', async () => {
    const { pipeline, work, app, start, seen, head, approveChapter } = await ready()
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'complete' })
    const request = start(2)
    const response = await app.request(`/api/works/${work.id}/chapters/start`, post(request))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'advanced', state: { pendingGate: { kind: 'beat', chapter: 2 } }, beatCommand: { target: { chapter: 2 } } })
    expect(seen.at(-1)).toMatchObject({ kind: 'beat', input: { chapter: 2, upstream: { outline: head('outline').content, setting: head('setting').content, previousChapter: { chapter: 1, beat: head('beat', 1).content, prose: head('prose', 1).content } } } })
    expect((await app.request(`/api/works/${work.id}/chapters/start`, post(request))).status).toBe(200)
    expect(seen.filter(s => s.kind === 'beat' && s.input.chapter === 2)).toHaveLength(1)
    await approveChapter(2)
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'complete' })
    await app.request(`/api/works/${work.id}/chapters/start`, post(request))
    expect(head('beat', 3)).toBeUndefined()
    const view = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    expect(view).toMatchObject({ currentChapter: 2, chapters: [{ chapter: 1, proseStatus: 'approved' }, { chapter: 2, proseStatus: 'approved' }] })
    expect(view.chapters[1]!.allowedActions).toContain('start-next-chapter')
  })
  it('keeps later chapters after an old approved edit and restores a continuity warning from stored input references', async () => {
    const { work, pipeline, store, app, start, head, approveChapter } = await ready()
    await pipeline.startChapter(work.id, start(2)); await approveChapter(2)
    await pipeline.startChapter(work.id, start(3))
    const later = head('prose', 2)
    const first = head('prose', 1)
    await saveProse(store, work.id, { chapter: 1, expectedArtifactId: first.id, expectedHeadVersion: first.version, expectedHumanStatus: 'approved', content: { text: '第一章新增一个会影响衔接的事实。' } })
    expect(head('prose', 2)).toEqual(later)
    const view = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    expect(view.chapters.map(c => c.needsContinuityReview)).toEqual([false, true, true])
    expect(view.chapters[0]!.allowedActions).toContain('save-draft')
    expect(head('prose', 1).humanStatus).toBe('approved')
  })
  it('rejects a stale start baseline or skipped chapter before a model call', async () => {
    const { work, pipeline, seen, start, head, store } = await ready()
    const request = start(2), previous = head('prose', 1), count = seen.length
    await saveProse(store, work.id, { chapter: 1, expectedArtifactId: previous.id, expectedHeadVersion: previous.version, expectedHumanStatus: 'approved', content: { text: '修改后的第一章。' } })
    await expect(pipeline.startChapter(work.id, request)).rejects.toMatchObject({ code: 'version-conflict' })
    await expect(pipeline.startChapter(work.id, { ...start(2), chapter: 3 })).rejects.toMatchObject({ code: 'chapter-not-ready' })
    expect(seen).toHaveLength(count)
    expect(head('beat', 2)).toBeUndefined()
  })
  it('shares the generation lock and discards chapter two when its previous approved prose changes in flight', async () => {
    let release!: () => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    const { work, pipeline, start, head, store } = await ready(async (input, kind) => { if (kind === 'beat' && input.chapter === 2) { entered(); await waiting } })
    const running = pipeline.startChapter(work.id, start(2))
    await started
    await expect(pipeline.startChapter(work.id, start(2))).rejects.toMatchObject({ code: 'advance-in-progress' })
    await expect(pipeline.advance(work.id)).rejects.toMatchObject({ code: 'advance-in-progress' })
    const previous = head('prose', 1)
    await saveProse(store, work.id, { chapter: 1, expectedArtifactId: previous.id, expectedHeadVersion: previous.version, expectedHumanStatus: 'approved', content: { text: '生成期间更改第一章。' } })
    release()
    expect(await running).toMatchObject({ kind: 'failed', code: 'upstream-changed', beatCommand: { target: { chapter: 2 }, writeOutcome: 'not-committed' } })
    expect(head('beat', 2)).toBeUndefined()
    expect(head('prose', 1).content).toEqual({ text: '生成期间更改第一章。' })
  })
  it('validates HTTP start bodies, predecessor versions and approval before generating', async () => {
    const { work, app, start, seen, head, store } = await ready()
    const request = start(2), count = seen.length
    for (const body of [{ ...request, chapter: 1 }, { ...request, chapter: 0 }, { ...request, chapter: 2.5 },
      { ...request, chapter: Number.MAX_SAFE_INTEGER + 1 }, { ...request, expectedPreviousProseId: '' }, { ...request, extra: 'ignored?' }]) {
      expect((await app.request(`/api/works/${work.id}/chapters/start`, post(body))).status).toBe(400)
    }
    expect((await app.request(`/api/works/${work.id}/chapters/start`, { ...post({}), body: '{' })).status).toBe(400)
    expect((await app.request(`/api/works/${work.id}/chapters/start`, post({ ...request, expectedPreviousProseVersion: 99 }))).status).toBe(409)
    expect((await app.request(`/api/works/${work.id}/chapters/start`, post({ ...request, chapter: 3 }))).status).toBe(409)
    const previous = head('prose', 1)
    store.appendArtifact(work.id, 'prose', previous.content, { chapter: 1 })
    expect((await app.request(`/api/works/${work.id}/chapters/start`, post(start(2)))).status).toBe(409)
    expect(seen).toHaveLength(count)
  })
  it('routes chapter two saves, regeneration and approval to chapter two while chapter one remains editable', async () => {
    const { work, app, start, head, seen } = await ready()
    const original = head('prose', 1)
    const saveFirst = await app.request(`/api/works/${work.id}/artifacts/prose/save`, post({ chapter: 1, expectedArtifactId: original.id,
      expectedHeadVersion: original.version, expectedHumanStatus: 'approved', content: { text: '上一章作者最新保存的正文。' } }))
    expect(saveFirst.status).toBe(200)
    const startResponse = await app.request(`/api/works/${work.id}/chapters/start`, post(start(2)))
    expect(advanceOutcomeDtoSchema.safeParse(await startResponse.json()).success).toBe(true)
    expect(seen.at(-1)!.input.upstream).toMatchObject({ previousChapter: { prose: { text: '上一章作者最新保存的正文。' } } })
    let beat = head('beat', 2)
    const regenerate = await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post({ chapter: 2, expectedArtifactId: beat.id,
      expectedHeadVersion: beat.version, content: beat.content, instructions: '改一下' }))
    expect(regenerate.status).toBe(200)
    beat = head('beat', 2)
    const approvedBeat = await app.request(`/api/works/${work.id}/artifacts/beat/approve`, post({ chapter: 2, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beat.content }))
    expect(approvedBeat.status).toBe(200)
    expect(await approvedBeat.json()).toMatchObject({ command: { target: { chapter: 2 } } })
    await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    let prose = head('prose', 2)
    const saved = await app.request(`/api/works/${work.id}/artifacts/prose/save`, post({ chapter: 2, expectedArtifactId: prose.id, expectedHeadVersion: prose.version, expectedHumanStatus: 'pending', content: { text: '第二章人工编辑' } }))
    expect(saved.status).toBe(200)
    expect(proseCommandResponseSchema.parse(await saved.json()).command).toMatchObject({ target: { chapter: 2 } })
    prose = head('prose', 2)
    const rewritten = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, post({ chapter: 2, expectedArtifactId: prose.id, expectedHeadVersion: prose.version, content: prose.content, instructions: '' }))
    expect(rewritten.status).toBe(200)
    prose = head('prose', 2)
    expect((await app.request(`/api/works/${work.id}/artifacts/prose/approve`, post({ chapter: 2, expectedArtifactId: prose.id, expectedHeadVersion: prose.version, content: prose.content }))).status).toBe(200)
    expect(head('prose', 1).content).toEqual({ text: '上一章作者最新保存的正文。' })
    expect(await (await app.request('/api/works')).json()).toEqual([expect.objectContaining({ chapterCount: 2 })])
  })

  it('replans a historical chapter through two explicit gates and exposes immutable history to Harness', async () => {
    const { work, pipeline, app, start, head, approveChapter, seen, store } = await ready()
    await pipeline.startChapter(work.id, start(2)); await approveChapter(2)
    await pipeline.startChapter(work.id, start(3)); await approveChapter(3)

    const initialView = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    const oldBeat = beatArtifactSchema.parse(structuredClone(initialView.artifacts.find(artifact => artifact.kind === 'beat' && artifact.chapter === 1)))
    const oldProse = proseArtifactSchema.parse(structuredClone(initialView.artifacts.find(artifact => artifact.kind === 'prose' && artifact.chapter === 1)))
    const later = [2, 2, 3, 3].map((chapter, index) => structuredClone(initialView.artifacts.find(artifact => artifact.kind === (index % 2 === 0 ? 'beat' : 'prose') && artifact.chapter === chapter)))
    const binding = { mode: 'chapter-regeneration' as const,
      expectedBeat: { artifactId: oldBeat.id, version: oldBeat.version },
      expectedProse: { artifactId: oldProse.id, version: oldProse.version } }
    const beatRequest = { chapter: 1, expectedArtifactId: oldBeat.id, expectedHeadVersion: oldBeat.version,
      content: oldBeat.content, instructions: '重新安排本章冲突节奏', regeneration: binding }
    const beforeBeatCallCount = seen.filter(item => item.kind === 'beat').length
    const beatResponse = await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post(beatRequest))
    expect(beatResponse.status).toBe(200)
    const beatBody = beatCommandResponseSchema.parse(await beatResponse.json())
    expect(beatBody).toMatchObject({ artifact: { chapter: 1, version: 2, humanStatus: 'pending' }, command: { regeneration: binding },
      workflow: { workflowState: 'awaiting-beat-review', allowedActions: ['approve', 'regenerate'] } })
    const replannedBeat = { artifact: beatArtifactSchema.parse(beatBody.artifact) }
    expect(head('prose', 1)).toEqual(oldProse)
    expect(seen.filter(item => item.kind === 'beat')).toHaveLength(beforeBeatCallCount + 1)
    expect((await app.request(`/api/works/${work.id}`)).status).toBe(200)
    const afterBeatView = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    expect(afterBeatView.chapters.find(chapter => chapter.chapter === 1)?.allowedActions).toEqual(['approve', 'regenerate'])

    const afterFirstBeatCallCount = seen.filter(item => item.kind === 'beat').length
    expect((await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post(beatRequest))).status).toBe(409)
    expect(seen.filter(item => item.kind === 'beat')).toHaveLength(afterFirstBeatCallCount)
    const wrongBeatIdRequest = { ...beatRequest, expectedArtifactId: 'wrong-beat-id', regeneration: { ...binding, expectedBeat: { artifactId: 'wrong-beat-id', version: oldBeat.version } } }
    expect((await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post(wrongBeatIdRequest))).status).toBe(409)
    expect(seen.filter(item => item.kind === 'beat')).toHaveLength(afterFirstBeatCallCount)
    const pendingBeatRequest = { ...beatRequest, expectedArtifactId: replannedBeat.artifact.id, expectedHeadVersion: replannedBeat.artifact.version,
      content: replannedBeat.artifact.content, regeneration: { ...binding, expectedBeat: { artifactId: replannedBeat.artifact.id, version: replannedBeat.artifact.version } } }
    expect((await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post(pendingBeatRequest))).status).toBe(409)
    expect(seen.filter(item => item.kind === 'beat')).toHaveLength(afterFirstBeatCallCount)

    const proseRequest = { chapter: 1, expectedArtifactId: oldProse.id, expectedHeadVersion: oldProse.version,
      content: oldProse.content, instructions: '', regeneration: { ...binding, expectedBeat: { artifactId: replannedBeat.artifact.id, version: replannedBeat.artifact.version } } }
    const beforeProseCallCount = seen.filter(item => item.kind === 'prose').length
    await expect(pipeline.regenerateProse(work.id, proseRequest)).rejects.toMatchObject({ cause: { code: 'prose-gate-not-ready' } })
    expect(seen.filter(item => item.kind === 'prose')).toHaveLength(beforeProseCallCount)
    expect(head('prose', 1)).toEqual(oldProse)

    await approveBeat(store, work.id, { chapter: 1, expectedArtifactId: replannedBeat.artifact.id, expectedHeadVersion: replannedBeat.artifact.version, content: replannedBeat.artifact.content })
    const proseResponse = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, post(proseRequest))
    expect(proseResponse.status).toBe(200)
    const proseBody = proseCommandResponseSchema.parse(await proseResponse.json())
    expect(proseBody).toMatchObject({ artifact: { chapter: 1, version: 2, humanStatus: 'pending' }, command: { regeneration: proseRequest.regeneration },
      workflow: { workflowState: 'awaiting-prose-review', allowedActions: ['save-draft', 'approve', 'regenerate'] } })
    const replannedProse = { artifact: proseArtifactSchema.parse(proseBody.artifact) }
    expect(replannedProse.artifact.inputs).toContainEqual({ kind: 'beat', chapter: 1, artifactId: replannedBeat.artifact.id, version: replannedBeat.artifact.version })
    await approveProse(store, work.id, { chapter: 1, expectedArtifactId: replannedProse.artifact.id, expectedHeadVersion: replannedProse.artifact.version, content: proseContentSchema.parse(replannedProse.artifact.content) })

    const afterProseCallCount = seen.filter(item => item.kind === 'prose').length
    expect((await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, post(proseRequest))).status).toBe(409)
    expect(seen.filter(item => item.kind === 'prose')).toHaveLength(afterProseCallCount)
    const wrongProseIdRequest = { ...proseRequest, expectedArtifactId: 'wrong-prose-id', regeneration: { ...proseRequest.regeneration, expectedProse: { artifactId: 'wrong-prose-id', version: oldProse.version } } }
    expect((await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, post(wrongProseIdRequest))).status).toBe(409)
    expect(seen.filter(item => item.kind === 'prose')).toHaveLength(afterProseCallCount)

    const after = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    expect(after.chapters.find(chapter => chapter.chapter === 1)?.allowedActions).toContain('regenerate-chapter')
    expect(after.chapters.slice(1).map(chapter => chapter.needsContinuityReview)).toEqual([true, true])
    expect([head('beat', 2), head('prose', 2), head('beat', 3), head('prose', 3)]).toEqual(later)

    for (const artifact of [oldBeat, oldProse]) {
      const response = await app.request(`/api/works/${work.id}/artifacts/${artifact.kind}/${artifact.chapter}/versions/${artifact.version}?artifactId=${encodeURIComponent(artifact.id)}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(artifact)
    }
    const stale = await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post(beatRequest))
    expect(stale.status).toBe(409)
    expect(head('beat', 1).version).toBe(2)
  })
  it('does not infer a completed beat gate when the old prose source reference is absent', async () => {
    const { work, pipeline, store, app, head, seen } = await ready()
    const beat = beatArtifactSchema.parse(head('beat', 1))
    const prose = proseArtifactSchema.parse(head('prose', 1))
    const noSource = store.saveArtifact({ workId: work.id, kind: 'prose', chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: prose.version,
      expectedHumanStatus: 'approved', content: prose.content })
    const view = workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json())
    const chapter = view.chapters.find(chapter => chapter.chapter === 1)
    expect(chapter?.allowedActions).toContain('regenerate-chapter')
    expect(chapter?.allowedActions).not.toContain('regenerate-chapter-prose')
    const request = { chapter: 1, expectedArtifactId: noSource.id, expectedHeadVersion: noSource.version, content: proseContentSchema.parse(noSource.content), instructions: '',
      regeneration: { mode: 'chapter-regeneration' as const, expectedBeat: { artifactId: beat.id, version: beat.version }, expectedProse: { artifactId: noSource.id, version: noSource.version } } }
    const before = seen.filter(item => item.kind === 'prose').length
    await expect(pipeline.regenerateProse(work.id, request)).rejects.toMatchObject({ cause: { code: 'prose-gate-not-ready' } })
    expect(seen.filter(item => item.kind === 'prose')).toHaveLength(before)
  })
  it('regenerates ordinary pending Beat and Prose gates in all three historical chapters', async () => {
    const { work, pipeline, app, start, head, approveChapter, store } = await ready()
    await pipeline.startChapter(work.id, start(2)); await approveChapter(2)
    await pipeline.startChapter(work.id, start(3)); await approveChapter(3)

    for (const chapter of [1, 2, 3]) {
      const oldBeat = beatArtifactSchema.parse(head('beat', chapter))
      const oldProse = proseArtifactSchema.parse(head('prose', chapter))
      const binding = { mode: 'chapter-regeneration' as const,
        expectedBeat: { artifactId: oldBeat.id, version: oldBeat.version },
        expectedProse: { artifactId: oldProse.id, version: oldProse.version } }
      const chapterBeat = await pipeline.regenerateBeat(work.id, { chapter, expectedArtifactId: oldBeat.id, expectedHeadVersion: oldBeat.version,
        content: oldBeat.content, instructions: '产生历史章纲 pending', regeneration: binding })
      const pendingBeat = beatArtifactSchema.parse(chapterBeat.artifact)
      expect(workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json()).chapters.find(item => item.chapter === chapter)?.allowedActions)
        .toContain('regenerate')

      const ordinaryBeatResponse = await app.request(`/api/works/${work.id}/artifacts/beat/regenerate`, post({ chapter,
        expectedArtifactId: pendingBeat.id, expectedHeadVersion: pendingBeat.version,
        content: pendingBeat.content, instructions: '普通章纲再生' }))
      expect(ordinaryBeatResponse.status).toBe(200)
      const ordinaryBeat = beatCommandResponseSchema.parse(await ordinaryBeatResponse.json())
      expect(ordinaryBeat.workflow.workflowState).toBe('awaiting-beat-review')
      expect(ordinaryBeat.command.regeneration).toBeUndefined()
      const regeneratedBeat = beatArtifactSchema.parse(ordinaryBeat.artifact)
      await approveBeat(store, work.id, { chapter, expectedArtifactId: regeneratedBeat.id, expectedHeadVersion: regeneratedBeat.version, content: regeneratedBeat.content })

      const chapterProse = await pipeline.regenerateProse(work.id, { chapter, expectedArtifactId: oldProse.id, expectedHeadVersion: oldProse.version,
        content: oldProse.content, instructions: '产生历史正文 pending', regeneration: { ...binding,
          expectedBeat: { artifactId: regeneratedBeat.id, version: regeneratedBeat.version } } })
      const pendingProse = proseArtifactSchema.parse(chapterProse.artifact)
      expect(workViewSchema.parse(await (await app.request(`/api/works/${work.id}`)).json()).chapters.find(item => item.chapter === chapter)?.allowedActions)
        .toContain('regenerate')

      const ordinaryProseResponse = await app.request(`/api/works/${work.id}/artifacts/prose/regenerate`, post({ chapter,
        expectedArtifactId: pendingProse.id, expectedHeadVersion: pendingProse.version,
        content: pendingProse.content, instructions: '普通正文再生' }))
      expect(ordinaryProseResponse.status).toBe(200)
      const ordinaryProse = proseCommandResponseSchema.parse(await ordinaryProseResponse.json())
      expect(ordinaryProse.workflow.workflowState).toBe('awaiting-prose-review')
      expect(ordinaryProse.command.regeneration).toBeUndefined()
      const regeneratedProse = proseArtifactSchema.parse(ordinaryProse.artifact)
      await approveProse(store, work.id, { chapter, expectedArtifactId: regeneratedProse.id, expectedHeadVersion: regeneratedProse.version, content: regeneratedProse.content })
    }
  })
  it.each(['initial', 'rewrite'] as const)('discards chapter two Prose %s after its previous Prose is edited during the model call', async mode => {
    let mutate = async () => {}
    const { work, pipeline, start, head, store } = await ready(async (input, kind) => { if (kind === 'prose' && input.chapter === 2) await mutate() })
    await pipeline.startChapter(work.id, start(2))
    const beat = head('beat', 2)
    await approveBeat(store, work.id, { chapter: 2, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beatContentSchema.parse(beat.content) })
    if (mode === 'rewrite') await pipeline.advance(work.id)
    const before = head('prose', 2)
    mutate = async () => {
      const previous = head('prose', 1)
      await saveProse(store, work.id, { chapter: 1, expectedArtifactId: previous.id, expectedHeadVersion: previous.version, expectedHumanStatus: 'approved', content: { text: '并发修改旧章正文' } })
    }
    if (mode === 'initial') expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'failed', code: 'upstream-changed', proseCommand: { target: { chapter: 2 }, writeOutcome: 'not-committed' } })
    else await expect(pipeline.regenerateProse(work.id, { chapter: 2, expectedArtifactId: before.id, expectedHeadVersion: before.version, content: { text: '原来的编辑' }, instructions: '' })).rejects.toMatchObject({ cause: { code: 'upstream-changed' }, command: { target: { chapter: 2 }, writeOutcome: 'not-committed' } })
    expect(head('prose', 2)).toEqual(before)
  })

  it.each(['commit', 'response'] as const)('keeps a started chapter after an ambiguous %s failure and replays its target without another model call', async stage => {
    class AmbiguousStartStore extends InMemoryStore {
      fail = false
      failRead = false
      override getWork(id: string) {
        if (this.failRead) { this.failRead = false; throw new Error('private-response-marker') }
        return super.getWork(id)
      }
      override appendArtifact(...args: Parameters<InMemoryStore['appendArtifact']>) {
        const artifact = super.appendArtifact(...args)
        if (this.fail && args[1] === 'beat' && args[3]?.chapter === 2) {
          this.fail = false
          if (stage === 'commit') throw new Error('private-postwrite-marker')
          this.failRead = true
        }
        return artifact
      }
    }
    const store = new AmbiguousStartStore()
    const { app, work, start, head, seen } = await ready(undefined, store)
    const request = start(2)
    store.fail = true
    const response = await app.request(`/api/works/${work.id}/chapters/start`, post(request))
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('private-')
    expect(body).toMatchObject(stage === 'commit'
      ? { kind: 'failed', beatCommand: { target: { chapter: 2 }, writeOutcome: 'unknown' } }
      : { command: { target: { chapter: 2 }, writeOutcome: 'unknown', failureStage: 'response' } })
    const generated = head('beat', 2)
    expect(generated.humanStatus).toBe('pending')
    const replay = await app.request(`/api/works/${work.id}/chapters/start`, post(request))
    expect(replay.status).toBe(200)
    expect(head('beat', 2)).toEqual(generated)
    expect(seen.filter(s => s.kind === 'beat' && s.input.chapter === 2)).toHaveLength(1)
  })

})
