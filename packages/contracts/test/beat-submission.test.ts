import { describe, expect, it } from 'vitest'
import { matchesBeatSubmission, recoverBeatSubmission } from '../src/beat-submission.js'
import type { BeatArtifact } from '../src/beat.js'

const baseline: BeatArtifact = {
  id: 'artifact-original', workId: 'work-original', kind: 'beat', chapter: 1, version: 1,
  humanStatus: 'pending', createdAt: '2026-09-08T00:00:00.000Z',
  content: { title: '原稿', goal: '目标', writingPlan: [{ itemId: 'beat-item-old', title: '原安排', content: '说明' }], ending: '落点' },
}
const request = { chapter: 1 as const, expectedArtifactId: baseline.id, expectedHeadVersion: 1,
  content: { ...baseline.content, title: ' 作者修改 ', writingPlan: [{ title: '新卡', content: '**作者决定**' }] },
}
const approved: BeatArtifact = { ...baseline, humanStatus: 'approved', content: {
  ...request.content, title: '作者修改', writingPlan: [{ itemId: 'beat-item-11111111-1111-4111-8111-111111111111', title: '新卡', content: '**作者决定**' }],
} }
const work = (head: BeatArtifact) => ({ id: baseline.workId, title: '合成作品', seed: '合成素材', config: {}, createdAt: baseline.createdAt,
  artifacts: [head], workflowState: head.humanStatus === 'pending' ? 'awaiting-beat-review' : 'beat-approved',
  nextStepId: null, allowedActions: head.humanStatus === 'pending' ? ['approve', 'regenerate'] : [],
})
describe('Beat submission recovery', () => {
  it('trusts only documented code/status pairs for execution rejection, never arbitrary 5xx metadata', () => {
    const body = { code: 'llm-unavailable', retryable: true, message: 'model unavailable', command: {
      kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-beat',
      target: { workId: baseline.workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 },
      writeOutcome: 'not-committed', failureStage: 'model', attemptIds: [], executionMode: 'live', latencyMs: 1,
    } }
    const input = { baseline, submission: { operation: 'regenerate-beat' as const, request: { ...request, instructions: '' } },
      hasUnknownWrite: false, work: work(baseline), workIsReadback: true }
    expect(recoverBeatSubmission({ ...input, response: { status: 503, body } })).toMatchObject({ resolution: 'rejected', nextActions: ['edit-input'] })
    for (const status of [500, 501, 502, 504]) {
      expect(recoverBeatSubmission({ ...input, response: { status, body } })).toMatchObject({ resolution: 'uncertain', hasUnknownWrite: true })
    }
    expect(recoverBeatSubmission({ ...input, response: { status: 503, body: { ...body, code: 'unrecognized' } } })).toMatchObject({ resolution: 'uncertain' })
  })
  it('treats a valid edited approval as forward from the previously observed pending baseline', () => {
    const response = { status: 200, body: { artifact: approved, telemetry: [], workflow: { workflowState: 'beat-approved', nextStepId: null, allowedActions: [] }, command: {
      kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'approve-beat', target: { workId: baseline.workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 }, writeOutcome: 'committed', attemptIds: [], executionMode: 'demo', latencyMs: 1, resultHead: { artifactId: baseline.id, version: 1, humanStatus: 'approved' },
    } } }
    expect(recoverBeatSubmission({ baseline, submission: { operation: 'approve-beat', request }, hasUnknownWrite: false, response, work: work(baseline) })).toMatchObject({ resolution: 'confirmed', artifact: approved })
  })
  it('confirms normalized author approval without accepting a deleted card identity', () => {
    expect(matchesBeatSubmission(baseline, request, approved)).toBe(true)
    expect(matchesBeatSubmission(baseline, request, { ...approved, content: { ...approved.content, writingPlan: [{ ...approved.content.writingPlan[0]!, itemId: 'beat-item-old' }] } })).toBe(false)
    expect(recoverBeatSubmission({ baseline, submission: { operation: 'approve-beat', request }, hasUnknownWrite: true, work: work(approved) })).toMatchObject({ resolution: 'confirmed' })
  })
  it('does not claim an unknown regeneration succeeded merely because a newer head is visible', () => {
    const result = recoverBeatSubmission({ baseline, submission: { operation: 'regenerate-beat', request: { ...request, instructions: '' } },
      hasUnknownWrite: true, work: work({ ...baseline, id: 'artifact-new', version: 2 }),
    })
    expect(result).toMatchObject({ resolution: 'conflict', hasUnknownWrite: true, observedHead: { artifactId: 'artifact-new', version: 2 } })
    expect(result.nextActions).toContain('load-server-version')
  })
  it('accepts a bound request rejection without clearing any older unknown write', () => {
    const response = { status: 413, body: { code: 'payload-too-large', message: 'request too large', retryable: false,
      command: { kind: 'request-rejected', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-beat',
        writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [], executionMode: 'live', latencyMs: 2 },
    } }
    const input = { baseline, submission: { operation: 'regenerate-beat' as const, request: { ...request, instructions: '' } }, response }
    expect(recoverBeatSubmission({ ...input, hasUnknownWrite: false })).toMatchObject({ resolution: 'rejected', hasUnknownWrite: false, nextActions: ['edit-input'] })
    expect(recoverBeatSubmission({ ...input, hasUnknownWrite: true, work: work(baseline) })).toMatchObject({ resolution: 'uncertain', hasUnknownWrite: true })
    expect(recoverBeatSubmission({ ...input, response: { ...response, status: 500 }, hasUnknownWrite: false })).toMatchObject({ resolution: 'uncertain' })
  })
  it('accepts a valid regeneration response, but never downgrades a newer observed head', () => {
    const regenerated = { ...baseline, id: 'artifact-new', version: 2, content: approved.content }
    const response = { status: 200, body: { artifact: regenerated, telemetry: [], workflow: { workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] },
      command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-beat',
        target: { workId: baseline.workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1 },
        writeOutcome: 'committed', attemptIds: [], executionMode: 'demo', latencyMs: 2, resultHead: { artifactId: regenerated.id, version: 2, humanStatus: 'pending' } },
    } }
    const input = { baseline, submission: { operation: 'regenerate-beat' as const, request: { ...request, instructions: '' } }, response, hasUnknownWrite: false }
    expect(recoverBeatSubmission(input)).toMatchObject({ resolution: 'confirmed', artifact: regenerated })
    expect(recoverBeatSubmission({ ...input, work: work({ ...regenerated, id: 'artifact-v3', version: 3 }) })).toMatchObject({ resolution: 'conflict' })
    expect(recoverBeatSubmission({ ...input, work: work({ ...regenerated, humanStatus: 'approved' }) })).toMatchObject({ resolution: 'conflict' })
  })
})
