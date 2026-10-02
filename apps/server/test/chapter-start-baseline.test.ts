import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PipelineInput } from '../src/pipeline/pipeline.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { SqliteStore } from '../src/store/sqlite-store.js'
import { createApp } from '../src/app.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep, createFakeBeatStep, createFakeProseStep } from '../src/steps/fake-step.js'
import { caption, creative, outline, setting, beat } from './fixtures/artifact-content.js'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

function ready() {
  const directory = mkdtempSync(join(tmpdir(), 'a4n-start-baseline-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'work.sqlite')
  const store = new SqliteStore(path), other = new SqliteStore(path)
  cleanups.push(() => store.close(), () => other.close())
  const work = store.createWork({ seed: 'continue the approved chapter' })
  for (const [kind, content] of [
    ['caption', caption('known source')], ['creative', creative('chosen direction')],
    ['outline', outline('approved outline')],
  ] as const) store.appendArtifact(work.id, kind, content, { humanStatus: 'approved' })
  for (const [kind, content, chapter] of [
    ['setting', setting('approved setting'), undefined], ['beat', beat('chapter one'), 1],
    ['prose', { text: 'Approved first chapter.' }, 1],
  ] as const) {
    const pending = store.appendArtifact(work.id, kind, content, { chapter })
    store.finalizeArtifact({ workId: work.id, kind, chapter, expectedArtifactId: pending.id, expectedHeadVersion: pending.version, content: pending.content })
  }
  const previous = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose' && a.chapter === 1)!
  const seen: PipelineInput[] = []
  let onConfig = () => {}, onModel = () => {}
  const beatStep = createFakeBeatStep(), runBeat = beatStep.run.bind(beatStep)
  beatStep.run = async (input, config) => {
    seen.push(input)
    onModel()
    return runBeat(input, config)
  }
  const steps = new Map([
    ['caption', createFakeCaptionStep()], ['creative', createFakeCreativeStep()], ['outline', createFakeOutlineStep()],
    ['setting', createFakeSettingStep()], ['beat', beatStep], ['prose', createFakeProseStep()],
  ])
  const pipeline = new Pipeline({ store, consumeGuards, repeatChapters: true, steps,
    resolveConfig: () => ({ directionCount: 1 }),
    snapshotConfig: () => { onConfig(); return Object.fromEntries([...steps.keys()].map(id => [id, { directionCount: 1 }])) },
    definition: [
      { stepId: 'caption', outputKind: 'caption' },
      { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
      { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
      { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
      { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
      { stepId: 'prose', outputKind: 'prose', chapter: 1, consumes: ['beat', 'setting'], gateAfter: { kind: 'prose', chapter: 1 } },
    ],
  })
  const head = (kind: string, chapter: number) => store.getWork(work.id)!.artifacts.find(a => a.kind === kind && a.chapter === chapter)
  const editPrevious = () => {
    const baseline = head('prose', 1)!
    return other.saveArtifact({ workId: work.id, kind: 'prose', chapter: 1, expectedArtifactId: baseline.id,
      expectedHeadVersion: baseline.version, expectedHumanStatus: 'approved', content: { text: 'Updated first chapter from another connection.' } })
  }
  const request = { chapter: 2, expectedPreviousProseId: previous.id, expectedPreviousProseVersion: previous.version }
  const app = createApp({ store, pipeline, meta: { demo: true } })
  return { work, store, pipeline, app, seen, head, request, editPrevious,
    beforeInputs: (callback: () => void) => { onConfig = callback }, duringModel: (callback: () => void) => { onModel = callback } }
}

describe('start chapter predecessor baseline', () => {
  it('rejects the original HTTP request when another connection edits its predecessor before actual input sampling', async () => {
    const { app, work, store, seen, head, request, editPrevious, beforeInputs } = ready()
    // The public configuration snapshot is a controlled interleaving with a
    // second SQLite connection, rather than a single-process HTTP await race.
    beforeInputs(() => { beforeInputs(() => {}); editPrevious() })
    const response = await app.request(`/api/works/${work.id}/chapters/start`, post(request))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'failed', code: 'upstream-changed', retryable: true,
      beatCommand: { target: { chapter: 2 }, writeOutcome: 'not-committed', failureStage: 'precondition' } })
    expect(seen).toEqual([])
    expect(head('prose', 1)).toMatchObject({ version: 2, humanStatus: 'approved' })
    expect(head('beat', 2)).toBeUndefined()
    expect(store.listWorks()[0]!.chapterCount).toBe(1)
  })

  it('requires an explicit updated baseline to retry and keeps an existing target replay read-only', async () => {
    const { pipeline, work, seen, head, request, editPrevious, beforeInputs } = ready()
    beforeInputs(() => { beforeInputs(() => {}); editPrevious() })
    expect(await pipeline.startChapter(work.id, request)).toMatchObject({ kind: 'failed', code: 'upstream-changed' })
    await expect(pipeline.startChapter(work.id, request)).rejects.toMatchObject({ code: 'version-conflict' })
    expect(seen).toEqual([])

    const current = head('prose', 1)!
    const updatedRequest = { ...request, expectedPreviousProseId: current.id, expectedPreviousProseVersion: current.version }
    expect(await pipeline.startChapter(work.id, updatedRequest)).toMatchObject({ kind: 'advanced',
      state: { pendingGate: { kind: 'beat', chapter: 2 } } })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.upstream).toMatchObject({ previousChapter: { chapter: 1, prose: current.content } })
    const second = head('beat', 2)!
    expect(second.inputs).toContainEqual({ kind: 'prose', chapter: 1, artifactId: current.id, version: 2 })

    editPrevious()
    expect(await pipeline.startChapter(work.id, request)).toMatchObject({ kind: 'awaiting-approval' })
    expect(head('beat', 2)).toEqual(second)
    expect(head('beat', 3)).toBeUndefined()
    expect(seen).toHaveLength(1)
  })

  it('does not commit a sampled predecessor after another SQLite connection edits it during generation', async () => {
    const { pipeline, work, store, seen, head, request, editPrevious, duringModel } = ready()
    const original = head('prose', 1)!
    duringModel(editPrevious)
    expect(await pipeline.startChapter(work.id, request)).toMatchObject({ kind: 'failed', code: 'upstream-changed',
      beatCommand: { target: { chapter: 2 }, writeOutcome: 'not-committed', failureStage: 'commit' } })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.upstream).toMatchObject({ previousChapter: { chapter: 1, prose: original.content } })
    expect(head('prose', 1)).toMatchObject({ version: 2, humanStatus: 'approved' })
    expect(head('beat', 2)).toBeUndefined()
    expect(store.listWorks()[0]!.chapterCount).toBe(1)
  })
})
