import { describe, expect, it } from 'vitest'
import * as c from '../src/index.js'
import type { ProseArtifact, ProseApproveRequest } from '../src/index.js'
const baseline: ProseArtifact = { id: 'p1', workId: 'w1', kind: 'prose', chapter: 1, version: 1, humanStatus: 'pending', createdAt: 'today', content: { text: '原文' } }
const request: ProseApproveRequest = { chapter: 1, expectedArtifactId: 'p1', expectedHeadVersion: 1, content: { text: '  人工\n\n最终文字。\n' } }
const approved = { ...baseline, humanStatus: 'approved', content: request.content }
const view = (artifact: unknown) => ({ id: 'w1', title: '测试', seed: '', config: {}, createdAt: 'today', artifacts: [artifact], workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] })
const command = { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-prose', target: { workId: 'w1', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: 'p1', version: 1 }, executionMode: 'demo', latencyMs: 0, attemptIds: [], writeOutcome: 'committed', resultHead: { artifactId: 'p2', version: 2, humanStatus: 'pending' } }
const next = { ...baseline, id: 'p2', version: 2, content: { text: '新版' } }
const rewrite = { operation: 'regenerate-prose' as const, request: { ...request, instructions: '建议' } }

describe('prose command results and recovery', () => {
  it('confirms only the exact approved author text and identity, including whitespace', () => {
    expect(c.matchesProseSubmission).toBeDefined()
    expect(c.matchesProseSubmission(baseline, request, approved)).toBe(true)
    for (const wrong of [{ ...approved, content: { text: request.content.text.trim() } }, { ...approved, workId: 'w2' }, { ...approved, id: 'p2' }, { ...approved, version: 2 }, { ...approved, chapter: 2 }, { ...approved, humanStatus: 'pending' }]) expect(c.matchesProseSubmission(baseline, request, wrong)).toBe(false)
    expect(c.recoverProseSubmission({ baseline, submission: { operation: 'approve-prose', request }, hasUnknownWrite: true, work: view(approved), workIsReadback: true })).toMatchObject({ resolution: 'confirmed', hasUnknownWrite: false, artifact: approved })
  })
  it('does not claim unknown rewrite success from a new head or clear earlier unknown after rejection', () => {
    expect(c.recoverProseSubmission).toBeDefined()
    expect(c.recoverProseSubmission({ baseline, submission: rewrite, hasUnknownWrite: true, work: view(next) })).toMatchObject({ resolution: 'conflict', hasUnknownWrite: true })
    const failure = { code: 'llm-timeout', retryable: true, message: 'llm-timeout', command: { ...command, resultHead: undefined, writeOutcome: 'not-committed', failureStage: 'model' } }
    expect(c.recoverProseSubmission({ baseline, submission: rewrite, hasUnknownWrite: true, response: { status: 504, body: failure }, work: view(baseline), workIsReadback: true })).toMatchObject({ resolution: 'uncertain', hasUnknownWrite: true })
    expect(c.recoverProseSubmission({ baseline, submission: rewrite, hasUnknownWrite: false, response: { status: 504, body: failure }, work: view(baseline), workIsReadback: true })).toMatchObject({ resolution: 'rejected', nextActions: ['edit-input'], hasUnknownWrite: false })
  })
  it('accepts a bound valid rewrite response but rejects a stale or internally inconsistent result', () => {
    expect(c.proseCommandResponseSchema).toBeDefined()
    const body = { artifact: next, command, workflow: { workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }, telemetry: [] }
    expect(c.proseCommandResponseSchema.safeParse(body).success).toBe(true)
    expect(c.recoverProseSubmission({ baseline, submission: rewrite, hasUnknownWrite: false, response: { status: 200, body } })).toMatchObject({ resolution: 'confirmed', artifact: next })
    expect(c.recoverProseSubmission({ baseline, submission: rewrite, hasUnknownWrite: false, response: { status: 200, body }, work: view({ ...next, id: 'p3', version: 3 }) })).toMatchObject({ resolution: 'conflict' })
    expect(c.proseCommandResponseSchema.safeParse({ ...body, artifact: { ...next, version: 3 } }).success).toBe(false)
    expect(c.recoverProseSubmission({ baseline, submission: rewrite, hasUnknownWrite: false, response: { status: 200, body: { ...body, command: { ...command, target: { ...command.target, workId: 'w2' } } } } })).toMatchObject({ resolution: 'uncertain' })
  })
  it('validates public prose content and rejects response pollution', () => {
    expect(c.workViewSchema.safeParse(view(baseline)).success).toBe(true)
    expect(c.workViewSchema.safeParse(view({ ...baseline, content: { text: '', extra: 'private' } })).success).toBe(false)
    expect(c.proseCommandErrorSchema).toBeDefined()
    expect(c.proseCommandErrorSchema.safeParse({ code: 'bad-json', message: 'bad-json', retryable: false, command: { kind: 'request-rejected', requestId: command.requestId, operation: 'approve-prose', executionMode: 'demo', latencyMs: 0, writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [] } }).success).toBe(true)
  })
})
