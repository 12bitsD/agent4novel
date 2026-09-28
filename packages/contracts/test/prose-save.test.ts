import { describe, expect, it } from 'vitest'
import * as c from '../src/index.js'
import type { ProseArtifact } from '../src/index.js'

const baseline: ProseArtifact = { id: 'p1', workId: 'w1', kind: 'prose', chapter: 1, version: 1, humanStatus: 'pending', createdAt: 'today', content: { text: '原文' } }
const request = { chapter: 1 as const, expectedArtifactId: baseline.id, expectedHeadVersion: baseline.version, expectedHumanStatus: 'pending' as const, content: { text: '' } }
const view = (artifact: unknown) => ({ id: 'w1', title: '测试', seed: '', config: {}, createdAt: 'today', artifacts: [artifact], workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['save-draft', 'approve', 'regenerate'] })
const command = { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose', target: { workId: 'w1', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: 'p1', version: 1, humanStatus: 'pending' }, executionMode: 'demo', latencyMs: 0, attemptIds: [], writeOutcome: 'committed', resultHead: { artifactId: 'p2', version: 2, humanStatus: 'pending' } }
const next = { ...baseline, id: 'p2', version: 2, content: request.content }

describe('Prose saves preserve review state and current full text', () => {
  it('requires the status-bearing save baseline and permits empty pending drafts but never empty approved text', () => {
    expect(c.proseSaveRequestSchema).toBeDefined()
    expect(c.proseSaveRequestSchema.parse(request)).toEqual(request)
    expect(c.proseSaveRequestSchema.safeParse({ ...request, expectedHumanStatus: undefined }).success).toBe(false)
    expect(c.proseSaveRequestSchema.safeParse({ ...request, expectedHumanStatus: 'approved' }).success).toBe(false)
    expect(c.proseSaveRequestSchema.parse({ ...request, expectedHumanStatus: 'approved', content: { text: '  仍是已通过正文。\n' } }).content).toEqual({ text: '  仍是已通过正文。\n' })
    expect(c.proseArtifactSchema.safeParse(next).success).toBe(true)
    expect(c.workViewSchema.safeParse(view(next)).success).toBe(true)
    expect(c.proseArtifactSchema.safeParse({ ...next, humanStatus: 'approved' }).success).toBe(false)
    expect(c.workViewSchema.safeParse(view({ ...next, humanStatus: 'approved' })).success).toBe(false)
    expect(c.proseApproveRequestSchema.safeParse({ ...request, expectedHumanStatus: undefined }).success).toBe(false)
  })
  it('validates same-status versioned save results and rejects generated empty drafts or model attempts on save', () => {
    const body = { artifact: next, command, workflow: { workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['save-draft', 'approve', 'regenerate'] }, telemetry: [] }
    expect(c.proseCommandResponseSchema.safeParse(body).success).toBe(true)
    for (const invalid of [{ ...command, expectedHead: { artifactId: 'p1', version: 1 } }, { ...command, attemptIds: ['model-attempt'] },
      { ...command, resultHead: { ...command.resultHead, humanStatus: 'approved' } }, { ...command, resultHead: { ...command.resultHead, artifactId: 'p1' } }]) {
      expect(c.proseCommandObservationSchema.safeParse(invalid).success).toBe(false)
    }
    expect(c.proseCommandResponseSchema.safeParse({ ...body, command: { ...command, operation: 'regenerate-prose', expectedHead: { artifactId: 'p1', version: 1 } } }).success).toBe(false)
  })
  it('confirms an exact save readback, remains conservative on conflicts, and preserves old unknown after later rejection', () => {
    const submission = { operation: 'save-prose' as const, request }
    expect(c.recoverProseSubmission({ baseline, submission, hasUnknownWrite: true, work: view(next), workIsReadback: true })).toMatchObject({ resolution: 'confirmed', artifact: next, hasUnknownWrite: false })
    for (const artifact of [{ ...next, version: 3 }, { ...next, content: { text: 'different' } }, { ...next, humanStatus: 'approved', content: { text: 'final' } }]) {
      expect(c.recoverProseSubmission({ baseline, submission, hasUnknownWrite: true, work: view(artifact), workIsReadback: true })).toMatchObject({ resolution: 'conflict', hasUnknownWrite: true })
    }
    const failure = { code: 'version-conflict', message: 'version-conflict', retryable: false, command: { ...command, resultHead: undefined, writeOutcome: 'not-committed', failureStage: 'precondition' } }
    expect(c.recoverProseSubmission({ baseline, submission, hasUnknownWrite: true, work: view(baseline), workIsReadback: true, response: { status: 409, body: failure } })).toMatchObject({ resolution: 'uncertain', hasUnknownWrite: true })
    const approved = { ...baseline, humanStatus: 'approved' as const }
    const approvedRequest = { ...request, expectedHumanStatus: 'approved' as const, content: { text: '  修改后仍通过。\n' } }
    const saved = { ...approved, id: 'p2', version: 2, content: approvedRequest.content }
    expect(c.recoverProseSubmission({ baseline: approved, submission: { operation: 'save-prose', request: approvedRequest }, hasUnknownWrite: true, work: view(saved), workIsReadback: true })).toMatchObject({ resolution: 'confirmed', artifact: saved })
  })
})
