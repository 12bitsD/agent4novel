import { describe, expect, it } from 'vitest'
import { initProseReview, reduceProseReview } from './prose-review.js'
import type { ProseArtifact, WorkView } from '@agent4novel/contracts'

const baseline: ProseArtifact = { id: 'artifact-test', workId: 'work-test', kind: 'prose', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-08',
  content: { text: '模型初稿' },
}
describe('Prose editor public state', () => {
  it('shows the safe assembled input budget when regeneration is rejected before the model', () => {
    let state = reduceProseReview(initProseReview(baseline), { type: 'start', operation: 'regenerate-prose' })
    state = reduceProseReview(state, { type: 'result', response: { status: 422, body: {
      code: 'input-budget-exceeded', message: 'input too large', retryable: false,
      inputBudget: { actualLength: 400001, limit: 400000, systemChars: 1, beatChars: 200000, settingChars: 200000, draftChars: 0, instructionsChars: 0 },
      command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-prose',
        target: { workId: baseline.workId, kind: 'prose', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 },
        executionMode: 'live', latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'input' },
    } } })
    expect(state.notice).toContain('400001 / 400000')
    expect(state.notice).toContain('未调用模型')
  })
  const work = (artifacts: ProseArtifact[]): WorkView => ({ id: baseline.workId, title: 'test', seed: 'synthetic', config: {}, createdAt: baseline.createdAt, artifacts, workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] })
  it('requires a successful post-command read before restoring revoked gate permissions', () => {
    let state = reduceProseReview(initProseReview(baseline), { type: 'observe', work: work([baseline]) })
    state = reduceProseReview(state, { type: 'start', operation: 'regenerate-prose' })
    state = reduceProseReview(state, { type: 'result', response: { status: 409, body: { code: 'prose-gate-not-ready', message: 'gate not ready', retryable: false, command: {
      kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-prose', target: { workId: baseline.workId, kind: 'prose', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 }, executionMode: 'demo', latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'precondition',
    } } } })
    expect(state.canResume).toBe(false)
    state = reduceProseReview(state, { type: 'readback' })
    expect(state.canResume).toBe(false)
    state = reduceProseReview(state, { type: 'readback', work: work([baseline]) })
    expect(state.canResume).toBe(true)
  })
  it('does not unlock an unknown request by loading the unchanged pending server baseline', () => {
    let state = reduceProseReview(initProseReview(baseline), { type: 'observe', work: work([baseline]) })
    state = reduceProseReview(state, { type: 'start', operation: 'regenerate-prose' })
    state = reduceProseReview(state, { type: 'result' })
    expect(reduceProseReview(state, { type: 'load-server' })).toEqual(state)
  })
  it('preserves an observed newer head when a later stale read omits the Prose', () => {
    let state = reduceProseReview(initProseReview(baseline), { type: 'start', operation: 'regenerate-prose' })
    state = reduceProseReview(state, { type: 'result' })
    state = reduceProseReview(state, { type: 'readback', work: work([{ ...baseline, id: 'artifact-v3', version: 3 }]) })
    state = reduceProseReview(state, { type: 'readback', work: work([]) })
    expect(state.recovery?.observedHead).toMatchObject({ version: 3 })
    expect(state.remote?.version).toBe(3)
  })
  it('freezes the exact visible prose and prevents changes while submitting', () => {
    let state = initProseReview(baseline)
    state = reduceProseReview(state, { type: 'text', value: '  作者修改\n\n下一段\n' })
    state = reduceProseReview(state, { type: 'start', operation: 'approve-prose' })
    expect(state.phase).toBe('submitting')
    expect(state.submitted?.request.content.text).toBe('  作者修改\n\n下一段\n')
    expect(reduceProseReview(state, { type: 'text', value: '迟到编辑' }).draft.text).toBe('  作者修改\n\n下一段\n')
    expect(baseline.content.text).toBe('模型初稿')
  })
  it('keeps frozen content and instructions when a later rejection follows an unknown request', () => {
    let state = initProseReview(baseline)
    state = reduceProseReview(state, { type: 'instructions', value: '作者意见' })
    state = reduceProseReview(state, { type: 'start', operation: 'regenerate-prose' })
    state = reduceProseReview(state, { type: 'result' })
    expect(state.hasUnknownWrite).toBe(true)
    state = reduceProseReview(state, { type: 'result', response: { status: 400, body: { code: 'invalid-input', message: 'invalid request', retryable: false,
      command: { kind: 'request-rejected', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-prose', executionMode: 'demo', latencyMs: 0,
        writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [] },
    } } })
    expect(state.phase).toBe('uncertain')
    expect(state.instructions).toBe('作者意见')
    expect(state.submitted?.request.content).toEqual(baseline.content)
    expect(reduceProseReview(state, { type: 'resume' }).phase).toBe('uncertain')
  })
})
