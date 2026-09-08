import { beatApproveRequestSchema, beatRegenerateRequestSchema, beatArtifactSchema, recoverBeatSubmission, beatCommandErrorSchema } from '@agent4novel/contracts'
import type { BeatArtifact, BeatEditDraft, BeatSubmission, ValidationIssue, WorkView, BeatRecovery } from '@agent4novel/contracts'

export type BeatEditorDraft = Omit<BeatEditDraft, 'writingPlan'> & { writingPlan: Array<BeatEditDraft['writingPlan'][number] & { localKey: string }> }
export type BeatReviewState = {
  baseline: BeatArtifact; draft: BeatEditorDraft; instructions: string; mode: 'preview' | 'edit'
  phase: 'editing' | 'submitting' | 'regenerating' | 'reconciling' | 'uncertain' | 'conflict' | 'approved'
  submitted?: BeatSubmission; hasUnknownWrite: boolean; issues: ValidationIssue[]; notice?: string
  response?: { status: number; body: unknown }; observedWork?: WorkView; remote?: BeatArtifact; recovery?: BeatRecovery; canResume?: boolean
}
export type BeatReviewAction =
  | { type: 'field'; field: 'title' | 'goal' | 'ending'; value: string }
  | { type: 'item'; key: string; field: 'title' | 'content'; value: string }
  | { type: 'add-item' } | { type: 'remove-item'; key: string } | { type: 'move-item'; key: string; direction: -1 | 1 }
  | { type: 'instructions'; value: string } | { type: 'mode'; mode: 'preview' | 'edit' }
  | { type: 'start'; operation: BeatSubmission['operation'] }
  | { type: 'result'; response?: { status: number; body: unknown } }
  | { type: 'observe'; work: WorkView } | { type: 'readback'; work?: WorkView }
  | { type: 'retry' } | { type: 'confirm' } | { type: 'resume' } | { type: 'load-server' }

export function initBeatReview(baseline: BeatArtifact): BeatReviewState {
  const content = structuredClone(baseline.content)
  return { baseline: structuredClone(baseline), draft: { ...content, writingPlan: content.writingPlan.map(item => ({ ...item, localKey: crypto.randomUUID() })) },
    instructions: '', mode: 'preview', phase: baseline.humanStatus === 'approved' ? 'approved' : 'editing', hasUnknownWrite: false, issues: [],
  }
}
export function toBeatSubmission(state: BeatReviewState, operation: BeatSubmission['operation']): BeatSubmission {
  const request = { chapter: 1 as const, expectedArtifactId: state.baseline.id, expectedHeadVersion: state.baseline.version,
    content: { ...state.draft, writingPlan: state.draft.writingPlan.map(({ localKey: _key, ...item }) => item) },
  }
  return operation === 'approve-beat' ? { operation, request } : { operation, request: { ...request, instructions: state.instructions } }
}
export function isBeatDirty(state: BeatReviewState): boolean {
  return state.instructions.length > 0 || JSON.stringify(toBeatSubmission(state, 'approve-beat').request.content) !== JSON.stringify(state.baseline.content)
    || ['submitting', 'regenerating', 'reconciling', 'uncertain'].includes(state.phase) || state.hasUnknownWrite
}
export function canLoadServerBeat(state: BeatReviewState): boolean {
  return state.phase === 'conflict' && !!state.remote && (!state.submitted || state.recovery?.nextActions.includes('load-server-version') === true)
}
export function reduceBeatReview(state: BeatReviewState, action: BeatReviewAction): BeatReviewState {
  if (action.type === 'mode') return { ...state, mode: action.mode }
  if (action.type === 'load-server') return canLoadServerBeat(state) ? initBeatReview(state.remote!) : state
  if (action.type === 'resume') return state.canResume && !state.hasUnknownWrite ? {
    ...state, phase: 'editing', submitted: undefined, response: undefined, recovery: undefined, canResume: false, issues: [], notice: undefined,
  } : state
  if (action.type === 'retry') return state.submitted && state.recovery?.nextActions.includes('retry-frozen-request')
    ? { ...state, phase: state.submitted.operation === 'approve-beat' ? 'submitting' : 'regenerating' } : state
  if (action.type === 'confirm') return { ...state, phase: 'reconciling' }
  if (action.type === 'observe' || action.type === 'readback' || action.type === 'result') {
    let observedWork = state.observedWork
    if (action.type !== 'result' && action.work?.id === state.baseline.workId) {
      const previous = observedWork?.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)
      const next = action.work.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)
      if (!previous || (next && (next.version > previous.version || (next.id === previous.id && next.version === previous.version
        && !(previous.humanStatus === 'approved' && next.humanStatus === 'pending'))))) observedWork = action.work
    }
    const remote = beatArtifactSchema.safeParse(observedWork?.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)).data
    const same = remote?.id === state.baseline.id && remote.version === state.baseline.version && remote.humanStatus === 'pending'
      && JSON.stringify(remote.content) === JSON.stringify(state.baseline.content)
    const allowed = observedWork?.workflowState === 'awaiting-beat-review' && observedWork.allowedActions.includes('approve')
    if (action.type === 'observe' && ['submitting', 'regenerating', 'reconciling'].includes(state.phase)) return { ...state, observedWork, remote }
    if (!state.submitted) {
      if (state.phase === 'approved') return { ...state, observedWork, remote }
      if (same && allowed && state.phase === 'editing') return { ...state, observedWork, remote }
      return { ...state, observedWork, remote, phase: 'conflict', canResume: same && allowed && !state.hasUnknownWrite,
        notice: '服务器关卡或章纲发生变化，本页修改已保留。' }
    }
    const response = action.type === 'result' ? action.response : state.response
    const recovery = recoverBeatSubmission({ baseline: state.baseline, submission: state.submitted, hasUnknownWrite: state.hasUnknownWrite, response, work: observedWork,
      workIsReadback: action.type !== 'result' && !!action.work && action.work === observedWork,
    })
    if (recovery.resolution === 'confirmed' && recovery.artifact) return { ...initBeatReview(recovery.artifact), notice: recovery.artifact.humanStatus === 'approved' ? '章纲已通过，后续正文将使用这份内容。' : '整份章纲已重新生成，请审阅后通过。' }
    const failure = beatCommandErrorSchema.safeParse(response?.body)
    const budget = failure.success && failure.data.code === 'input-budget-exceeded' ? failure.data.inputBudget : undefined
    const canResume = recovery.nextActions.includes('edit-input') && !recovery.hasUnknownWrite
    return { ...state, observedWork, remote, response, recovery, hasUnknownWrite: recovery.hasUnknownWrite, canResume,
      phase: recovery.resolution === 'uncertain' ? 'uncertain' : 'conflict',
      issues: failure.success ? failure.data.issues ?? [] : [],
      notice: recovery.resolution === 'uncertain' ? '提交结果尚未确认。内容与意见已冻结，可核对或重试同一请求。'
        : recovery.resolution === 'conflict' ? '服务器版本已变化。请保留本页内容，核对后明确选择载入。' : `本次未写入（${failure.success ? failure.data.code : 'request-rejected'}），本页修改已保留。${budget ? `完整输入 ${budget.actualLength} / ${budget.limit} 字符，未调用模型。请缩减输入或检查模型配置。` : ''}`,
    }
  }
  if (state.phase !== 'editing') return state
  if (action.type === 'start') {
    const submission = toBeatSubmission(state, action.operation)
    const parsed = (submission.operation === 'approve-beat' ? beatApproveRequestSchema : beatRegenerateRequestSchema).safeParse(submission.request)
    if (!parsed.success) return { ...state, mode: 'edit', issues: parsed.error.issues.map(({ path, code }) => ({ path, code, message: '请填写有效内容并检查长度限制' })) }
    // Freeze a clone of the visible source; the request schema normalizes titles at the boundary.
    return { ...state, submitted: structuredClone(submission), phase: action.operation === 'approve-beat' ? 'submitting' : 'regenerating', issues: [], notice: undefined }
  }
  if (action.type === 'instructions') return { ...state, instructions: action.value, issues: [] }
  const draft = structuredClone(state.draft)
  if (action.type === 'field') draft[action.field] = action.value
  else if (action.type === 'add-item') draft.writingPlan.push({ localKey: crypto.randomUUID(), title: '', content: '' })
  else {
    const index = draft.writingPlan.findIndex(item => item.localKey === action.key)
    if (index < 0) return state
    const item = draft.writingPlan[index]!
    if (action.type === 'item') item[action.field] = action.value
    if (action.type === 'remove-item') draft.writingPlan.splice(index, 1)
    if (action.type === 'move-item') {
      const to = index + action.direction
      if (to < 0 || to >= draft.writingPlan.length) return state
      draft.writingPlan.splice(index, 1)
      draft.writingPlan.splice(to, 0, item)
    }
  }
  return { ...state, draft, issues: [], notice: undefined }
}
