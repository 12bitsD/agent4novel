import { describe, expect, it } from 'vitest'
import { initBeatReview, reduceBeatReview, toBeatSubmission } from './beat-review.js'
import type { BeatArtifact, WorkView } from '@agent4novel/contracts'

const baseline: BeatArtifact = { id: 'artifact-test', workId: 'work-test', kind: 'beat', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-08',
  content: { title: '第一章', goal: '目标', writingPlan: [{ itemId: 'beat-item-old', title: '安排', content: '安排说明' }], ending: '落点' },
}
describe('Beat editor public state', () => {
  it('shows the safe assembled input budget when regeneration is rejected before the model', () => {
    let state = reduceBeatReview(initBeatReview(baseline), { type: 'start', operation: 'regenerate-beat' })
    state = reduceBeatReview(state, { type: 'result', response: { status: 422, body: {
      code: 'input-budget-exceeded', message: 'input too large', retryable: false,
      inputBudget: { actualLength: 400001, limit: 400000, systemChars: 1, outlineChars: 200000, settingChars: 200000, draftChars: 0, instructionsChars: 0 },
      command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-beat',
        target: { workId: baseline.workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 },
        executionMode: 'live', latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'input' },
    } } })
    expect(state.notice).toContain('400001 / 400000')
    expect(state.notice).toContain('未调用模型')
  })
  const work = (artifacts: BeatArtifact[]): WorkView => ({ id: baseline.workId, title: 'test', seed: 'synthetic', config: {}, createdAt: baseline.createdAt, artifacts, workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] })
  it('requires a successful post-command read before restoring revoked gate permissions', () => {
    let state = reduceBeatReview(initBeatReview(baseline), { type: 'observe', work: work([baseline]) })
    state = reduceBeatReview(state, { type: 'start', operation: 'regenerate-beat' })
    state = reduceBeatReview(state, { type: 'result', response: { status: 409, body: { code: 'beat-gate-not-ready', message: 'gate not ready', retryable: false, command: {
      kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-beat', target: { workId: baseline.workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 }, executionMode: 'demo', latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'precondition',
    } } } })
    expect(state.canResume).toBe(false)
    state = reduceBeatReview(state, { type: 'readback' })
    expect(state.canResume).toBe(false)
    state = reduceBeatReview(state, { type: 'readback', work: work([baseline]) })
    expect(state.canResume).toBe(true)
  })
  it('does not unlock an unknown request by loading the unchanged pending server baseline', () => {
    let state = reduceBeatReview(initBeatReview(baseline), { type: 'observe', work: work([baseline]) })
    state = reduceBeatReview(state, { type: 'start', operation: 'regenerate-beat' })
    state = reduceBeatReview(state, { type: 'result' })
    expect(reduceBeatReview(state, { type: 'load-server' })).toEqual(state)
  })
  it('preserves an observed newer head when a later stale read omits the Beat', () => {
    let state = reduceBeatReview(initBeatReview(baseline), { type: 'start', operation: 'regenerate-beat' })
    state = reduceBeatReview(state, { type: 'result' })
    state = reduceBeatReview(state, { type: 'readback', work: work([{ ...baseline, id: 'artifact-v3', version: 3 }]) })
    state = reduceBeatReview(state, { type: 'readback', work: work([]) })
    expect(state.recovery?.observedHead).toMatchObject({ version: 3 })
    expect(state.remote?.version).toBe(3)
  })
  it('freezes only the edited draft, strips local keys, and prevents mutations while submitting', () => {
    let state = initBeatReview(baseline)
    state = reduceBeatReview(state, { type: 'field', field: 'goal', value: '作者修改' })
    state = reduceBeatReview(state, { type: 'add-item' })
    const key = state.draft.writingPlan[1]!.localKey
    state = reduceBeatReview(state, { type: 'item', key, field: 'title', value: '新安排' })
    state = reduceBeatReview(state, { type: 'item', key, field: 'content', value: '新说明' })
    state = reduceBeatReview(state, { type: 'start', operation: 'approve-beat' })
    expect(state.phase).toBe('submitting')
    expect(state.submitted?.request.content.goal).toBe('作者修改')
    expect(JSON.stringify(toBeatSubmission(state, 'approve-beat'))).not.toContain('localKey')
    expect(reduceBeatReview(state, { type: 'field', field: 'goal', value: '迟到编辑' }).draft.goal).toBe('作者修改')
    expect(baseline.content.goal).toBe('目标')
  })
  it('keeps frozen content and instructions when a later rejection follows an unknown request', () => {
    let state = initBeatReview(baseline)
    state = reduceBeatReview(state, { type: 'instructions', value: '作者意见' })
    state = reduceBeatReview(state, { type: 'start', operation: 'regenerate-beat' })
    state = reduceBeatReview(state, { type: 'result' })
    expect(state.hasUnknownWrite).toBe(true)
    state = reduceBeatReview(state, { type: 'result', response: { status: 400, body: { code: 'invalid-input', message: 'invalid request', retryable: false,
      command: { kind: 'request-rejected', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-beat', executionMode: 'demo', latencyMs: 0,
        writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [] },
    } } })
    expect(state.phase).toBe('uncertain')
    expect(state.instructions).toBe('作者意见')
    expect(state.submitted?.request.content).toEqual(baseline.content)
    expect(reduceBeatReview(state, { type: 'resume' }).phase).toBe('uncertain')
  })
})
