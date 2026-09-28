import { proseArtifactSchema, proseApproveRequestSchema, proseSaveRequestSchema, type ProseArtifact, type ProseApproveRequest, type ProseRegenerateRequest, type ProseSaveRequest } from './prose.js'
import { workViewSchema } from './public-api.js'
import { proseCommandErrorSchema, proseCommandResponseSchema } from './prose-command.js'

export type ProseSubmission = { operation: 'approve-prose'; request: ProseApproveRequest } | { operation: 'regenerate-prose'; request: ProseRegenerateRequest } | { operation: 'save-prose'; request: ProseSaveRequest }
// A valid envelope alone cannot turn an undocumented HTTP failure into proof of no write.
const rejectionStatus: Readonly<Record<string, number>> = {
  'work-not-found': 404, 'artifact-not-found': 404,
  'version-conflict': 409, 'artifact-already-approved': 409, 'prose-gate-not-ready': 409,
  'upstream-changed': 409, 'advance-in-progress': 409, 'prose-approval-required': 409,
  'invalid-content': 422, 'input-budget-exceeded': 422,
  'llm-invalid-output': 502, 'llm-unavailable': 503, 'llm-timeout': 504,
}
export function matchesProseSubmission(baseline: ProseArtifact, submitted: ProseApproveRequest, candidate: unknown): boolean {
  const base = proseArtifactSchema.safeParse(baseline)
  const request = proseApproveRequestSchema.safeParse(submitted)
  const result = proseArtifactSchema.safeParse(candidate)
  if (!base.success || !request.success || !result.success) return false
  const original = base.data
  const actual = result.data
  return original.humanStatus === 'pending' && actual.humanStatus === 'approved'
    && actual.chapter === original.chapter && request.data.chapter === original.chapter && actual.workId === original.workId && actual.id === original.id && actual.version === original.version
    && actual.createdAt === original.createdAt && request.data.expectedArtifactId === original.id
    && request.data.expectedHeadVersion === original.version && request.data.content.text === actual.content.text
}
export function matchesProseSave(baseline: ProseArtifact, submitted: ProseSaveRequest, candidate: unknown): boolean {
  const base = proseArtifactSchema.safeParse(baseline)
  const request = proseSaveRequestSchema.safeParse(submitted)
  const result = proseArtifactSchema.safeParse(candidate)
  if (!base.success || !request.success || !result.success) return false
  return request.data.chapter === base.data.chapter && result.data.chapter === base.data.chapter && request.data.expectedArtifactId === base.data.id && request.data.expectedHeadVersion === base.data.version
    && request.data.expectedHumanStatus === base.data.humanStatus && result.data.workId === base.data.workId
    && result.data.id !== base.data.id && result.data.version === base.data.version + 1
    && result.data.humanStatus === base.data.humanStatus && result.data.content.text === request.data.content.text
}
export type ProseRecovery = {
  resolution: 'confirmed' | 'rejected' | 'uncertain' | 'conflict'
  nextActions: Array<'edit-input' | 'read-work' | 'retry-frozen-request' | 'load-server-version' | 'inspect-diagnostics' | 'check-model-config' | 'await-author'>
  hasUnknownWrite: boolean; artifact?: ProseArtifact
  observedHead?: { artifactId: string; version: number; humanStatus: 'pending' | 'approved' } | null
}
export function recoverProseSubmission(input: {
  baseline: ProseArtifact; submission: ProseSubmission; hasUnknownWrite: boolean; work?: unknown; workIsReadback?: boolean
  response?: { status: number; body: unknown }
}): ProseRecovery {
  const failure = input.response && input.response.status >= 400 ? proseCommandErrorSchema.safeParse(input.response.body) : undefined
  const command = failure?.success ? failure.data.command : undefined
  const rejectedRequest = command?.kind === 'request-rejected' && command.operation === input.submission.operation && failure?.success
    && input.response?.status === (failure.data.code === 'payload-too-large' ? 413 : 400)
  const rejectedExecution = command?.kind === 'execution-result' && command.operation === input.submission.operation
    && failure?.success && rejectionStatus[failure.data.code] === input.response?.status
    && command.target.chapter === input.baseline.chapter && input.submission.request.chapter === input.baseline.chapter && command.target.workId === input.baseline.workId && command.expectedHead?.artifactId === input.submission.request.expectedArtifactId
    && command.expectedHead.version === input.submission.request.expectedHeadVersion && command.writeOutcome === 'not-committed'
    && (input.submission.operation !== 'save-prose' || command.expectedHead.humanStatus === input.submission.request.expectedHumanStatus)
  const unknown = input.hasUnknownWrite || !(rejectedRequest || rejectedExecution)
  const view = workViewSchema.safeParse(input.work)
  const candidate = view.success && view.data.id === input.baseline.workId
    ? view.data.artifacts.find(a => a.kind === 'prose' && a.chapter === input.baseline.chapter) : undefined
  const observed = view.success && view.data.id === input.baseline.workId
    ? { observedHead: candidate ? { artifactId: candidate.id, version: candidate.version, humanStatus: candidate.humanStatus } : null } : {}
  const success = input.response?.status === 200 ? proseCommandResponseSchema.safeParse(input.response.body) : undefined
  if (success?.success && success.data.command.kind === 'execution-result') {
    const { artifact, command: resultCommand } = success.data
    const bound = resultCommand.operation === input.submission.operation && resultCommand.target.chapter === input.baseline.chapter && artifact.chapter === input.baseline.chapter && input.submission.request.chapter === input.baseline.chapter && resultCommand.target.workId === input.baseline.workId
      && resultCommand.expectedHead?.artifactId === input.baseline.id && resultCommand.expectedHead.version === input.baseline.version
      && input.submission.request.expectedArtifactId === input.baseline.id && input.submission.request.expectedHeadVersion === input.baseline.version
      && (input.submission.operation !== 'save-prose' || resultCommand.expectedHead.humanStatus === input.submission.request.expectedHumanStatus)
    const matches = input.submission.operation === 'approve-prose'
      ? matchesProseSubmission(input.baseline, input.submission.request, artifact)
      : input.submission.operation === 'save-prose' ? matchesProseSave(input.baseline, input.submission.request, artifact)
        : artifact.humanStatus === 'pending' && artifact.id !== input.baseline.id && artifact.version === input.baseline.version + 1
    const superseded = candidate && (candidate.version > artifact.version || (candidate.version === artifact.version
      && (candidate.id !== artifact.id || (candidate.humanStatus === 'approved' && artifact.humanStatus === 'pending')
        || (candidate.humanStatus === artifact.humanStatus && JSON.stringify(candidate.content) !== JSON.stringify(artifact.content)))))
    if (bound && matches && !superseded) return { ...observed, resolution: 'confirmed', nextActions: ['await-author'], hasUnknownWrite: false, artifact }
  }
  if (input.submission.operation === 'approve-prose' && matchesProseSubmission(input.baseline, input.submission.request, candidate)) {
    return { ...observed, resolution: 'confirmed', nextActions: ['await-author'], hasUnknownWrite: false, artifact: proseArtifactSchema.parse(candidate) }
  }
  if (input.submission.operation === 'save-prose' && matchesProseSave(input.baseline, input.submission.request, candidate)) {
    return { ...observed, resolution: 'confirmed', nextActions: ['await-author'], hasUnknownWrite: false, artifact: proseArtifactSchema.parse(candidate) }
  }
  if (candidate && candidate.version >= input.baseline.version && (candidate.id !== input.baseline.id || candidate.humanStatus !== input.baseline.humanStatus
    || JSON.stringify(candidate.content) !== JSON.stringify(input.baseline.content))) {
    return { ...observed, resolution: 'conflict', nextActions: ['read-work', 'load-server-version'], hasUnknownWrite: unknown }
  }
  if (!unknown) {
    const sameBaseline = candidate?.id === input.baseline.id && candidate.version === input.baseline.version && candidate.humanStatus === input.baseline.humanStatus
      && JSON.stringify(candidate.content) === JSON.stringify(input.baseline.content)
    const canEdit = rejectedRequest || (failure?.success && failure.data.code === 'invalid-content')
      || (input.workIsReadback === true && sameBaseline && view.success && (view.data.chapters.find(c => c.chapter === input.baseline.chapter)?.allowedActions ?? view.data.allowedActions).includes(input.submission.operation === 'approve-prose' ? 'approve' : input.submission.operation === 'save-prose' ? 'save-draft' : 'regenerate'))
    return { ...observed, resolution: 'rejected', nextActions: canEdit ? ['edit-input'] : ['read-work', 'inspect-diagnostics'], hasUnknownWrite: false }
  }
  return { ...observed, resolution: 'uncertain', nextActions: ['read-work', 'retry-frozen-request'], hasUnknownWrite: true }
}
