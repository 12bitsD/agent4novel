import type { ApiError, SettingArtifact, SettingApproveRequest, SettingReviewDraft, ValidationIssue, WorkView } from '@agent4novel/contracts'
import { matchesSettingSubmission, settingArtifactSchema, settingApproveRequestSchema, settingCardSections } from '@agent4novel/contracts'

type EditorItem = SettingReviewDraft['world'][number] & { localKey: string }
type EditorSection = Omit<SettingReviewDraft['extensions'][number], 'items'> & { localKey: string; items: EditorItem[] }
export type SettingEditorDraft = Omit<SettingReviewDraft, 'world' | 'characters' | 'factions' | 'relationships' | 'extensions'> & {
  world: EditorItem[]; characters: EditorItem[]; factions: EditorItem[]; relationships: EditorItem[]; extensions: EditorSection[]
}
export type SettingReviewState = {
  baseline: SettingArtifact; draft: SettingEditorDraft; revision: number; mode: 'preview' | 'edit'
  phase: 'editing' | 'submitting' | 'reconciling' | 'uncertain' | 'conflict' | 'approved'
  submitted?: { request: SettingApproveRequest; revision: number; positions: Record<string, string> }
  hasUnknownWrite: boolean; issues: ValidationIssue[]; focusTarget?: string; notice?: string
  canResume?: boolean; remote?: SettingArtifact
}
export type SettingReviewAction =
  | { type: 'overview'; value: string } | { type: 'mode'; mode: 'preview' | 'edit' }
  | { type: 'edit-item'; key: string; field: 'title' | 'content'; value: string }
  | { type: 'add-item'; target: string } | { type: 'remove-item'; key: string }
  | { type: 'move-item'; key: string; target: string }
  | { type: 'reorder-item'; key: string; direction: -1 | 1 }
  | { type: 'add-section' } | { type: 'remove-section'; key: string }
  | { type: 'rename-section'; key: string; value: string }
  | { type: 'reorder-section'; key: string; direction: -1 | 1 }
  | { type: 'submit' } | { type: 'rejected'; status: number; error: ApiError }
  | { type: 'unknown'; message: string } | { type: 'retry' }
  | { type: 'readback'; work: WorkView } | { type: 'readback-failed'; message: string }
  | { type: 'response'; candidate: unknown } | { type: 'reconcile' }
  | { type: 'resume' } | { type: 'discard-load'; artifact: SettingArtifact }
  | { type: 'observe-work'; work: WorkView }

export function initSettingReview(artifact: SettingArtifact): SettingReviewState {
  const item = (entry: SettingReviewDraft['world'][number]): EditorItem => ({ ...entry, localKey: crypto.randomUUID() })
  const content = artifact.content
  return { baseline: structuredClone(artifact), revision: 0, mode: 'preview',
    phase: artifact.humanStatus === 'approved' ? 'approved' : 'editing', hasUnknownWrite: false, issues: [], draft: {
    overview: content.overview, world: content.world.map(item), characters: content.characters.map(item),
    factions: content.factions.map(item), relationships: content.relationships.map(item),
    extensions: content.extensions.map((section) => ({ ...section, localKey: crypto.randomUUID(), items: section.items.map(item) })),
  } }
}
export function toSettingSubmission(state: SettingReviewState): SettingApproveRequest {
  const item = ({ localKey: _key, ...entry }: EditorItem) => entry
  const draft = state.draft
  return { expectedHeadVersion: state.baseline.version, content: {
    overview: draft.overview, world: draft.world.map(item), characters: draft.characters.map(item),
    factions: draft.factions.map(item), relationships: draft.relationships.map(item),
    extensions: draft.extensions.map(({ localKey: _key, items, ...section }) => ({ ...section, items: items.map(item) })),
  } }
}
export function isSettingDirty(state: SettingReviewState): boolean {
  return JSON.stringify(toSettingSubmission(state).content) !== JSON.stringify(state.baseline.content)
}
export function settingIssueTarget(draft: SettingEditorDraft, path: (string | number)[]): string {
  const parts = path[0] === 'content' ? path.slice(1) : path
  if (parts[0] === 'overview') return 'overview'
  if (parts[0] === 'extensions') {
    const section = draft.extensions[Number(parts[1])]
    if (!section) return 'extensions'
    if (parts[2] !== 'items') return `${section.localKey}:title`
    const item = section.items[Number(parts[3])]
    return item ? `${item.localKey}:${parts[4] === 'content' ? 'content' : 'title'}` : `${section.localKey}:add`
  }
  const section = settingCardSections.find((name) => name === parts[0])
  if (!section) return 'overview'
  const item = draft[section][Number(parts[1])]
  return item ? `${item.localKey}:${parts[2] === 'content' ? 'content' : 'title'}` : `${section}:add`
}
export function reduceSettingReview(state: SettingReviewState, action: SettingReviewAction): SettingReviewState {
  if (action.type === 'mode') return { ...state, mode: action.mode }
  if (action.type === 'observe-work') {
    if (action.work.id !== state.baseline.workId || state.phase === 'submitting' || state.phase === 'reconciling' || state.phase === 'approved' || state.phase === 'uncertain') return state
    const candidate = action.work.artifacts.find((artifact) => artifact.kind === 'setting')
    if (state.phase === 'editing' && candidate?.humanStatus === 'pending' && candidate.id === state.baseline.id && candidate.version === state.baseline.version
      && JSON.stringify(candidate.content) === JSON.stringify(state.baseline.content)) return state
    // 后台读取不是本次提交的确认响应：不能据此清掉本页草稿。
    const remote = settingArtifactSchema.safeParse(candidate).data
    const canResume = !state.hasUnknownWrite && remote?.humanStatus === 'pending' && remote.id === state.baseline.id && remote.version === state.baseline.version
      && JSON.stringify(remote.content) === JSON.stringify(state.baseline.content) && action.work.workflowState === 'awaiting-setting-review' && action.work.allowedActions.includes('approve')
    return { ...state, phase: 'conflict', remote, canResume, notice: '服务器关卡或设定发生变化。本页修改已保留，请核对后继续。' }
  }
  if (action.type === 'unknown') return { ...state, phase: 'reconciling', hasUnknownWrite: true, canResume: false, notice: action.message }
  if (action.type === 'reconcile') return { ...state, phase: 'reconciling', canResume: false }
  if (action.type === 'retry') return state.phase === 'uncertain' && state.submitted
    ? { ...state, phase: 'submitting', notice: undefined } : state
  if (action.type === 'readback-failed') return { ...state, phase: state.hasUnknownWrite ? 'uncertain' : 'conflict', canResume: false, notice: action.message }
  if (action.type === 'response' || action.type === 'readback') {
    if (action.type === 'readback' && action.work.id !== state.baseline.workId) return state
    const candidate = action.type === 'response' ? action.candidate : action.work.artifacts.find((artifact) => artifact.kind === 'setting')
    if (state.submitted && matchesSettingSubmission(state.baseline, state.submitted.request, candidate)) {
      const confirmed = settingArtifactSchema.parse(candidate)
      return { ...initSettingReview(confirmed), notice: '设定已通过，后续创作将使用这份内容。' }
    }
    if (action.type === 'response') return { ...state, phase: 'reconciling', hasUnknownWrite: true, notice: '通过响应未能确认，正在核对服务器结果。' }
    const parsed = settingArtifactSchema.safeParse(candidate)
    const remote = parsed.success ? parsed.data : undefined
    if (remote?.humanStatus === 'approved') return { ...state, phase: 'conflict', remote, canResume: false, notice: '服务器上的设定已通过，但与本页修改不同。你的修改仍保留在本页。' }
    if (state.hasUnknownWrite) return { ...state, phase: 'uncertain', remote, canResume: false, notice: '尚无法确认上次通过是否完成。可核对结果，或重试同一份提交。' }
    const unchanged = remote?.humanStatus === 'pending' && remote.id === state.baseline.id && remote.workId === state.baseline.workId
      && remote.version === state.baseline.version && JSON.stringify(remote.content) === JSON.stringify(state.baseline.content)
    return { ...state, phase: 'conflict', remote, canResume: unchanged && action.work.allowedActions.includes('approve') && action.work.workflowState === 'awaiting-setting-review',
      notice: unchanged ? '本地修改已保留。请先完成前置关卡；允许通过后可继续编辑。' : '服务器设定已变化或不存在。请保留本页内容并核对远端。' }
  }
  if (action.type === 'resume') return state.phase === 'conflict' && state.canResume && !state.hasUnknownWrite
    ? { ...state, phase: 'editing', submitted: undefined, issues: [], notice: undefined, canResume: false } : state
  if (action.type === 'discard-load') return initSettingReview(action.artifact)
  if (action.type === 'submit') {
    if (state.phase !== 'editing') return state
    const parsed = settingApproveRequestSchema.safeParse(toSettingSubmission(state))
    if (!parsed.success) {
      const issues = parsed.error.issues.map(({ path, code, message }) => ({ path, code, message }))
      return { ...state, mode: 'edit', issues, focusTarget: settingIssueTarget(state.draft, issues[0]!.path) }
    }
    const positions = Object.fromEntries([
      ['overview', 'overview'],
      ...settingCardSections.flatMap((section) => state.draft[section].flatMap((item, index) =>
        ['title', 'content', 'itemId'].map((field) => [JSON.stringify(['content', section, index, field]), `${item.localKey}:${field === 'content' ? 'content' : 'title'}`]))),
      ...state.draft.extensions.flatMap((section, sectionIndex) => [
        [JSON.stringify(['content', 'extensions', sectionIndex, 'title']), `${section.localKey}:title`],
        ...section.items.flatMap((item, index) => ['title', 'content', 'itemId'].map((field) =>
          [JSON.stringify(['content', 'extensions', sectionIndex, 'items', index, field]), `${item.localKey}:${field === 'content' ? 'content' : 'title'}`])),
      ]),
    ])
    return { ...state, phase: 'submitting', issues: [], focusTarget: undefined, notice: undefined,
      submitted: { request: parsed.data, revision: state.revision, positions } }
  }
  if (action.type === 'rejected') {
    if (state.hasUnknownWrite) return { ...state, phase: 'uncertain', notice: action.error.message, canResume: false }
    if (action.status === 409) return { ...state, phase: 'reconciling', notice: action.error.message, canResume: false }
    const issues = action.error.issues ?? []
    return { ...state, phase: 'editing', mode: action.status === 422 ? 'edit' : state.mode,
      issues, notice: action.error.message,
      focusTarget: issues[0] ? state.submitted?.positions[JSON.stringify(issues[0].path)] ?? settingIssueTarget(state.draft, issues[0].path) : undefined,
      submitted: undefined }
  }
  if (state.phase !== 'editing') return state
  const draft = structuredClone(state.draft)
  const containers = [
    ...settingCardSections.map((key) => ({ key, items: draft[key] })),
    ...draft.extensions.map((section) => ({ key: section.localKey, items: section.items })),
  ]
  if (action.type === 'overview') draft.overview = action.value
  else if (action.type === 'add-section') draft.extensions.push({ localKey: crypto.randomUUID(), title: '', items: [] })
  else if (action.type === 'remove-section' || action.type === 'rename-section' || action.type === 'reorder-section') {
    const index = draft.extensions.findIndex((section) => section.localKey === action.key)
    if (index < 0) return state
    const section = draft.extensions[index]!
    if (action.type === 'remove-section') draft.extensions.splice(index, 1)
    if (action.type === 'rename-section') section.title = action.value
    if (action.type === 'reorder-section') {
      const to = index + action.direction
      if (to < 0 || to >= draft.extensions.length) return state
      draft.extensions.splice(index, 1)
      draft.extensions.splice(to, 0, section)
    }
  }
  else if (action.type === 'add-item') {
    const target = containers.find((container) => container.key === action.target)
    if (!target) return state
    target.items.push({ localKey: crypto.randomUUID(), title: '', content: '' })
  } else {
    const container = containers.find((container) => container.items.some((item) => item.localKey === action.key))
    if (!container) return state
    const index = container.items.findIndex((item) => item.localKey === action.key)
    const item = container.items[index]!
    if (action.type === 'edit-item') item[action.field] = action.value
    if (action.type === 'remove-item') container.items.splice(index, 1)
    if (action.type === 'reorder-item') {
      const to = index + action.direction
      if (to < 0 || to >= container.items.length) return state
      container.items.splice(index, 1)
      container.items.splice(to, 0, item)
    }
    if (action.type === 'move-item') {
      const target = containers.find((container) => container.key === action.target)
      if (!target || target === container) return state
      container.items.splice(index, 1)
      target.items.push(item)
    }
  }
  return { ...state, draft, revision: state.revision + 1, issues: [], focusTarget: undefined, notice: undefined }
}
