import { beatArtifactSchema, beatApproveRequestSchema, type BeatArtifact, type BeatApproveRequest, type BeatRegenerateRequest } from './beat.js'
import { workViewSchema } from './public-api.js'
import { beatCommandErrorSchema, beatCommandResponseSchema } from './beat-command.js'

export type BeatSubmission = { operation: 'approve-beat'; request: BeatApproveRequest } | { operation: 'regenerate-beat'; request: BeatRegenerateRequest }
// A valid envelope alone cannot turn an undocumented HTTP failure into proof of no write.
const rejectionStatus: Readonly<Record<string, number>> = {
  'work-not-found': 404, 'artifact-not-found': 404,
  'version-conflict': 409, 'artifact-already-approved': 409, 'beat-gate-not-ready': 409,
  'upstream-changed': 409, 'advance-in-progress': 409, 'beat-approval-required': 409,
  'invalid-content': 422, 'input-budget-exceeded': 422,
  'llm-invalid-output': 502, 'llm-unavailable': 503, 'llm-timeout': 504,
}
const newCardId = /^beat-item-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function matchesBeatSubmission(baseline: BeatArtifact, submitted: BeatApproveRequest, candidate: unknown): boolean {
  const base = beatArtifactSchema.safeParse(baseline)
  const request = beatApproveRequestSchema.safeParse(submitted)
  const result = beatArtifactSchema.safeParse(candidate)
  if (!base.success || !request.success || !result.success) return false
  const original = base.data
  const actual = result.data
  if (original.humanStatus !== 'pending' || actual.humanStatus !== 'approved' || actual.workId !== original.workId
    || actual.id !== original.id || actual.version !== original.version || actual.createdAt !== original.createdAt
    || request.data.expectedArtifactId !== original.id || request.data.expectedHeadVersion !== original.version) return false
  const expected = request.data.content
  const ids = new Set(original.content.writingPlan.map(item => item.itemId))
  return expected.title === actual.content.title && expected.goal === actual.content.goal && expected.ending === actual.content.ending
    && expected.writingPlan.length === actual.content.writingPlan.length && expected.writingPlan.every((item, i) => {
      const found = actual.content.writingPlan[i]!
      return item.title === found.title && item.content === found.content && (item.itemId === undefined
        ? !ids.has(found.itemId) && newCardId.test(found.itemId) : ids.has(item.itemId) && item.itemId === found.itemId)
    })
}
export type BeatRecovery = {
  resolution: 'confirmed' | 'rejected' | 'uncertain' | 'conflict'
  nextActions: Array<'edit-input' | 'read-work' | 'retry-frozen-request' | 'load-server-version' | 'inspect-diagnostics' | 'check-model-config' | 'await-author'>
  hasUnknownWrite: boolean; artifact?: BeatArtifact
  observedHead?: { artifactId: string; version: number; humanStatus: 'pending' | 'approved' } | null
}
export function recoverBeatSubmission(input: {
  baseline: BeatArtifact; submission: BeatSubmission; hasUnknownWrite: boolean; work?: unknown; workIsReadback?: boolean
  response?: { status: number; body: unknown }
}): BeatRecovery {
  const failure = input.response && input.response.status >= 400 ? beatCommandErrorSchema.safeParse(input.response.body) : undefined
  const command = failure?.success ? failure.data.command : undefined
  const rejectedRequest = command?.kind === 'request-rejected' && command.operation === input.submission.operation && failure?.success
    && input.response?.status === (failure.data.code === 'payload-too-large' ? 413 : 400)
  const rejectedExecution = command?.kind === 'execution-result' && command.operation === input.submission.operation
    && failure?.success && rejectionStatus[failure.data.code] === input.response?.status
    && command.target.workId === input.baseline.workId && command.expectedHead?.artifactId === input.submission.request.expectedArtifactId
    && command.expectedHead.version === input.submission.request.expectedHeadVersion && command.writeOutcome === 'not-committed'
  const unknown = input.hasUnknownWrite || !(rejectedRequest || rejectedExecution)
  const view = workViewSchema.safeParse(input.work)
  const candidate = view.success && view.data.id === input.baseline.workId
    ? view.data.artifacts.find(a => a.kind === 'beat' && a.chapter === 1) : undefined
  const observed = view.success && view.data.id === input.baseline.workId
    ? { observedHead: candidate ? { artifactId: candidate.id, version: candidate.version, humanStatus: candidate.humanStatus } : null } : {}
  const success = input.response?.status === 200 ? beatCommandResponseSchema.safeParse(input.response.body) : undefined
  if (success?.success && success.data.command.kind === 'execution-result') {
    const { artifact, command: resultCommand } = success.data
    const bound = resultCommand.operation === input.submission.operation && resultCommand.target.workId === input.baseline.workId
      && resultCommand.expectedHead?.artifactId === input.baseline.id && resultCommand.expectedHead.version === input.baseline.version
      && input.submission.request.expectedArtifactId === input.baseline.id && input.submission.request.expectedHeadVersion === input.baseline.version
    const priorIds = new Set(input.baseline.content.writingPlan.map(item => item.itemId))
    const matches = input.submission.operation === 'approve-beat' ? matchesBeatSubmission(input.baseline, input.submission.request, artifact)
      : artifact.content.writingPlan.every(item => newCardId.test(item.itemId) && !priorIds.has(item.itemId))
    const superseded = candidate && (candidate.version > artifact.version || (candidate.version === artifact.version
      && (candidate.id !== artifact.id || (candidate.humanStatus === 'approved' && artifact.humanStatus === 'pending')
        || (candidate.humanStatus === artifact.humanStatus && JSON.stringify(candidate.content) !== JSON.stringify(artifact.content)))))
    if (bound && matches && !superseded) return { ...observed, resolution: 'confirmed', nextActions: ['await-author'], hasUnknownWrite: false, artifact }
  }
  if (input.submission.operation === 'approve-beat' && matchesBeatSubmission(input.baseline, input.submission.request, candidate)) {
    return { ...observed, resolution: 'confirmed', nextActions: ['await-author'], hasUnknownWrite: false, artifact: beatArtifactSchema.parse(candidate) }
  }
  if (candidate && candidate.version >= input.baseline.version && (candidate.id !== input.baseline.id || candidate.humanStatus !== 'pending'
    || JSON.stringify(candidate.content) !== JSON.stringify(input.baseline.content))) {
    return { ...observed, resolution: 'conflict', nextActions: ['read-work', 'load-server-version'], hasUnknownWrite: unknown }
  }
  if (!unknown) {
    const sameBaseline = candidate?.id === input.baseline.id && candidate.version === input.baseline.version && candidate.humanStatus === 'pending'
      && JSON.stringify(candidate.content) === JSON.stringify(input.baseline.content)
    const canEdit = rejectedRequest || (failure?.success && failure.data.code === 'invalid-content')
      || (input.workIsReadback === true && sameBaseline && view.success && view.data.workflowState === 'awaiting-beat-review' && view.data.allowedActions.includes(input.submission.operation === 'approve-beat' ? 'approve' : 'regenerate'))
    return { ...observed, resolution: 'rejected', nextActions: canEdit ? ['edit-input'] : ['read-work', 'inspect-diagnostics'], hasUnknownWrite: false }
  }
  return { ...observed, resolution: 'uncertain', nextActions: ['read-work', 'retry-frozen-request'], hasUnknownWrite: true }
}
