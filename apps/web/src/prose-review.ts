import { chapterActions, chapterLabel } from './chapter-view.js'
import { proseApproveRequestSchema, proseRegenerateRequestSchema, proseSaveRequestSchema, proseArtifactSchema, recoverProseSubmission, proseCommandErrorSchema } from '@agent4novel/contracts'
import type { ChapterRegenerationBinding, ProseArtifact, ProseEditDraft, ProseSubmission, ValidationIssue, WorkView, ProseRecovery } from '@agent4novel/contracts'

export type ProseReviewState = {
  baseline: ProseArtifact; draft: ProseEditDraft; instructions: string; mode: 'preview' | 'edit'
  phase: 'editing' | 'saving' | 'submitting' | 'regenerating' | 'reconciling' | 'uncertain' | 'conflict' | 'approved'
  submitted?: ProseSubmission; hasUnknownWrite: boolean; issues: ValidationIssue[]; notice?: string
  regeneration?: ChapterRegenerationBinding
  response?: { status: number; body: unknown }; observedWork?: WorkView; remote?: ProseArtifact; recovery?: ProseRecovery; canResume?: boolean
}
export type ProseReviewAction =
  | { type: 'text'; value: string }
  | { type: 'instructions'; value: string } | { type: 'mode'; mode: 'preview' | 'edit' }
  | { type: 'start'; operation: ProseSubmission['operation'] }
  | { type: 'result'; response?: { status: number; body: unknown } }
  | { type: 'observe'; work: WorkView } | { type: 'readback'; work?: WorkView }
  | { type: 'retry' } | { type: 'confirm' } | { type: 'resume' } | { type: 'load-server' }

export function initProseReview(baseline: ProseArtifact): ProseReviewState {
  const content = structuredClone(baseline.content)
  return { baseline: structuredClone(baseline), draft: content,
    instructions: '', mode: 'preview', phase: baseline.humanStatus === 'approved' ? 'approved' : 'editing', hasUnknownWrite: false, issues: [],
  }
}
export function toProseSubmission(state: ProseReviewState, operation: ProseSubmission['operation']): ProseSubmission {
  const request = { chapter: state.baseline.chapter, expectedArtifactId: state.baseline.id, expectedHeadVersion: state.baseline.version,
    content: { ...state.draft },
  }
  return operation === 'approve-prose' ? { operation, request }
    : operation === 'save-prose' ? { operation, request: { ...request, expectedHumanStatus: state.baseline.humanStatus } }
    : { operation, request: { ...request, instructions: state.instructions, ...(state.regeneration ? { regeneration: state.regeneration } : {}) } }
}
export function isProseDirty(state: ProseReviewState): boolean {
  return state.instructions.length > 0 || JSON.stringify(toProseSubmission(state, 'approve-prose').request.content) !== JSON.stringify(state.baseline.content)
    || ['saving', 'submitting', 'regenerating', 'reconciling', 'uncertain'].includes(state.phase) || state.hasUnknownWrite
}
export function canLoadServerProse(state: ProseReviewState): boolean {
  return state.phase === 'conflict' && !!state.remote && (!state.submitted || state.recovery?.nextActions.includes('load-server-version') === true)
}
export function reduceProseReview(state: ProseReviewState, action: ProseReviewAction): ProseReviewState {
  if (action.type === 'mode') return { ...state, mode: action.mode }
  if (action.type === 'load-server') return canLoadServerProse(state) ? initProseReview(state.remote!) : state
  if (action.type === 'resume') return state.canResume && !state.hasUnknownWrite ? {
    ...state, phase: state.baseline.humanStatus === 'approved' ? 'approved' : 'editing', submitted: undefined, response: undefined, recovery: undefined, canResume: false, issues: [], notice: undefined,
  } : state
  if (action.type === 'retry') return state.submitted && state.recovery?.nextActions.includes('retry-frozen-request')
    ? { ...state, phase: state.submitted.operation === 'approve-prose' ? 'submitting' : state.submitted.operation === 'save-prose' ? 'saving' : 'regenerating' } : state
  if (action.type === 'confirm') return { ...state, phase: 'reconciling' }
  if (action.type === 'observe' || action.type === 'readback' || action.type === 'result') {
    let observedWork = state.observedWork
    if (action.type !== 'result' && action.work?.id === state.baseline.workId) {
      const previous = observedWork?.artifacts.find(a => a.kind === 'prose' && a.chapter === state.baseline.chapter)
      const next = action.work.artifacts.find(a => a.kind === 'prose' && a.chapter === state.baseline.chapter)
      if (!previous || (next && (next.version > previous.version || (next.id === previous.id && next.version === previous.version
        && !(previous.humanStatus === 'approved' && next.humanStatus === 'pending'))))) observedWork = action.work
    }
    const remote = proseArtifactSchema.safeParse(observedWork?.artifacts.find(a => a.kind === 'prose' && a.chapter === state.baseline.chapter)).data
    const same = remote?.id === state.baseline.id && remote.version === state.baseline.version && remote.humanStatus === state.baseline.humanStatus
      && JSON.stringify(remote.content) === JSON.stringify(state.baseline.content)
    const allowed = chapterActions(observedWork, state.baseline.chapter).includes(state.baseline.humanStatus === 'approved' ? 'save-draft' : 'approve')
    if (action.type === 'observe' && ['saving', 'submitting', 'regenerating', 'reconciling'].includes(state.phase)) return { ...state, observedWork, remote }
    if (!state.submitted) {
      if (same && (allowed || state.phase === 'approved') && ['editing', 'approved'].includes(state.phase)) return { ...state, observedWork, remote }
      if (remote && remote.version > state.baseline.version && !isProseDirty(state)) return { ...initProseReview(remote), observedWork }
      return { ...state, observedWork, remote, phase: 'conflict', canResume: same && allowed && !state.hasUnknownWrite,
        notice: '服务器关卡或正文发生变化，本页修改已保留。' }
    }
    const response = action.type === 'result' ? action.response : state.response
    const recovery = recoverProseSubmission({ baseline: state.baseline, submission: state.submitted, hasUnknownWrite: state.hasUnknownWrite, response, work: observedWork,
      workIsReadback: action.type !== 'result' && !!action.work && action.work === observedWork,
    })
    if (recovery.resolution === 'confirmed' && recovery.artifact) {
      const next = initProseReview(recovery.artifact)
      if (state.submitted.operation === 'save-prose') return { ...next, draft: state.draft, instructions: state.instructions, mode: state.mode,
        notice: state.draft.text === recovery.artifact.content.text ? '已保存。' : '还有新的修改待保存。' }
      return { ...next, notice: recovery.artifact.humanStatus === 'approved' ? `${chapterLabel(state.baseline.chapter)}已完成。` : '整章正文已重写，请审阅后通过。' }
    }
    const failure = proseCommandErrorSchema.safeParse(response?.body)
    const budget = failure.success && failure.data.code === 'input-budget-exceeded' ? failure.data.inputBudget : undefined
    const canResume = recovery.nextActions.includes('edit-input') && !recovery.hasUnknownWrite
    return { ...state, observedWork, remote, response, recovery, hasUnknownWrite: recovery.hasUnknownWrite, canResume,
      phase: recovery.resolution === 'uncertain' ? 'uncertain' : 'conflict',
      issues: failure.success ? failure.data.issues ?? [] : [],
      notice: recovery.resolution === 'uncertain' ? '提交结果尚未确认。内容与意见已冻结，可核对或重试同一请求。'
        : recovery.resolution === 'conflict' ? '服务器版本已变化。请保留本页内容，核对后明确选择载入。' : `本次未写入（${failure.success ? failure.data.code : 'request-rejected'}），本页修改已保留。${budget ? `完整输入 ${budget.actualLength} / ${budget.limit} 字符，未调用模型。请缩减输入或检查模型配置。` : ''}`,
    }
  }
  const chapterRegenerationStart = state.regeneration !== undefined && state.phase === 'approved'
  if (!['editing', 'approved', 'saving'].includes(state.phase)) return state
  if (action.type === 'start') {
    if (state.phase === 'saving' || (state.baseline.humanStatus === 'approved' && !chapterRegenerationStart && action.operation !== 'save-prose')) return state
    const submission = toProseSubmission(state, action.operation)
    const parsed = (submission.operation === 'approve-prose' ? proseApproveRequestSchema : submission.operation === 'save-prose' ? proseSaveRequestSchema : proseRegenerateRequestSchema).safeParse(submission.request)
    if (!parsed.success) return { ...state, mode: 'edit', issues: parsed.error.issues.map(({ path, code }) => ({ path, code, message: '请填写有效内容并检查长度限制' })) }
    // Keep the exact visible text, including paragraph whitespace, frozen during submission.
    return { ...state, submitted: structuredClone(submission), phase: action.operation === 'approve-prose' ? 'submitting' : action.operation === 'save-prose' ? 'saving' : 'regenerating', issues: [], notice: undefined }
  }
  if (action.type === 'instructions') return { ...state, instructions: action.value, issues: [] }
  return action.type === 'text' ? { ...state, draft: { text: action.value }, issues: [], notice: undefined } : state
}
