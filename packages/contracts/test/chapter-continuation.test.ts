import { describe, expect, it } from 'vitest'
import { beatArtifactSchema, proseArtifactSchema, beatCommandResponseSchema, proseCommandResponseSchema, startChapterRequestSchema,
  matchesBeatSubmission, matchesProseSubmission, matchesProseSave, recoverProseSubmission, type BeatArtifact, type ProseArtifact } from '../src/index.js'

const beat: BeatArtifact = { id: 'b', workId: 'w', kind: 'beat', chapter: 2, version: 1, createdAt: 'today', humanStatus: 'pending',
  content: { title: '第二章', goal: '目标', writingPlan: [{ itemId: 'item-one', title: '推进', content: '推进故事' }], ending: '承接' } }
const prose: ProseArtifact = { id: 'p', workId: 'w', kind: 'prose', chapter: 2, version: 1, createdAt: 'today', humanStatus: 'pending', content: { text: '正文' } }
const request = { chapter: 2, expectedArtifactId: 'p', expectedHeadVersion: 1, content: { text: '修改正文' } }
const workflow = { workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['approve'] }

describe('chapter-addressed public contracts', () => {
  it('accepts later chapters and bounded explicit start identities, rejects malformed addresses', () => {
    expect(beatArtifactSchema.safeParse(beat).success).toBe(true)
    expect(proseArtifactSchema.safeParse(prose).success).toBe(true)
    const start = { chapter: 2, expectedPreviousProseId: 'p1', expectedPreviousProseVersion: 3 }
    expect(startChapterRequestSchema.parse(start)).toEqual(start)
    for (const chapter of [0, 1, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(startChapterRequestSchema.safeParse({ ...start, chapter }).success).toBe(false)
  })
  it('never confirms an approval or save from another chapter, even when forged identity and contents match', () => {
    const beatRequest = { chapter: 2, expectedArtifactId: beat.id, expectedHeadVersion: 1, content: beat.content }
    expect(matchesBeatSubmission(beat, beatRequest, { ...beat, humanStatus: 'approved' })).toBe(true)
    expect(matchesBeatSubmission(beat, beatRequest, { ...beat, chapter: 1, humanStatus: 'approved' })).toBe(false)
    expect(matchesProseSubmission(prose, request, { ...prose, content: request.content, humanStatus: 'approved' })).toBe(true)
    expect(matchesProseSubmission(prose, request, { ...prose, chapter: 1, content: request.content, humanStatus: 'approved' })).toBe(false)
    expect(matchesProseSave(prose, { ...request, expectedHumanStatus: 'pending' }, { ...prose, chapter: 1, id: 'p2', version: 2, content: request.content })).toBe(false)
  })
  it('binds response artifact chapter to command chapter', () => {
    for (const [artifact, schema, kind] of [[beat, beatCommandResponseSchema, 'beat'], [prose, proseCommandResponseSchema, 'prose']] as const) {
      const response = { artifact: { ...artifact, humanStatus: 'approved' }, telemetry: [], workflow,
        command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: `approve-${kind}`,
          target: { workId: 'w', kind, chapter: 1 }, expectedHead: { artifactId: artifact.id, version: 1 }, resultHead: { artifactId: artifact.id, version: 1, humanStatus: 'approved' },
          writeOutcome: 'committed', attemptIds: [], executionMode: 'demo', latencyMs: 0 } }
      expect(schema.safeParse(response).success).toBe(false)
    }
  })
  it('reads back the addressed chapter and allows a historical approved save while another chapter awaits Beat', () => {
    const baseline = { ...prose, chapter: 1, humanStatus: 'approved' as const }
    const saved = { ...baseline, id: 'saved', version: 2, content: request.content }
    const submission = { operation: 'save-prose' as const, request: { ...request, chapter: 1, expectedHumanStatus: 'approved' as const } }
    const view = { id: 'w', title: '', seed: '', config: {}, createdAt: 'today', artifacts: [saved, beat], workflowState: 'awaiting-beat-review', nextStepId: null,
      currentChapter: 2, allowedActions: ['approve', 'regenerate'], chapters: [
        { chapter: 1, title: '第一章', beatStatus: 'approved', proseStatus: 'approved', allowedActions: ['save-draft'], needsContinuityReview: false },
        { chapter: 2, title: '第二章', beatStatus: 'pending', proseStatus: null, allowedActions: ['approve', 'regenerate'], needsContinuityReview: true },
      ] }
    expect(recoverProseSubmission({ baseline, submission, hasUnknownWrite: true, work: view, workIsReadback: true })).toMatchObject({ resolution: 'confirmed', artifact: saved })
    const body = { code: 'version-conflict', message: '', retryable: false, command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose',
      target: { workId: 'w', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: 1, humanStatus: 'approved' }, writeOutcome: 'not-committed', failureStage: 'precondition', attemptIds: [], executionMode: 'demo', latencyMs: 0 } }
    expect(recoverProseSubmission({ baseline, submission, hasUnknownWrite: false, work: { ...view, artifacts: [baseline, beat] }, workIsReadback: true, response: { status: 409, body } })).toMatchObject({ resolution: 'rejected', nextActions: ['edit-input'] })
    expect(recoverProseSubmission({ baseline, submission, hasUnknownWrite: false, response: { status: 409, body: { ...body, command: { ...body.command, target: { workId: 'w', kind: 'prose', chapter: 2 } } } } })).toMatchObject({ resolution: 'uncertain' })
  })
})
