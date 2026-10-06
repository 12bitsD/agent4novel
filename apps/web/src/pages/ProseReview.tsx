import { chapterLabel } from '../chapter-view.js'
import { useRef, useState, type ReactNode } from 'react'
import BadExamplesPanel, { type SavedSelection, type BadExampleGuard } from './BadExamplesPanel.js'
import { proseLimits } from '@agent4novel/contracts'
import type { ProseReviewState, ProseReviewAction } from '../prose-review.js'
import { canLoadServerProse } from '../prose-review.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import MaterialFrame from '../MaterialFrame.js'
import { btnPrimary, btnSecondary, cardStyle, fieldStyle } from '../ui.js'

export default function ProseReview({ title, state, onAction, allowCommands, onApprove, onRegenerate, onConfirm, onRetry, onBadExampleGuard, primaryAction, contextLabel }: {
  title: string; state: ProseReviewState; onAction: (action: ProseReviewAction) => void; allowCommands: boolean
  onApprove: () => void; onRegenerate: () => void; onConfirm: () => void; onRetry: () => void
  onBadExampleGuard?: (guard: BadExampleGuard) => void
  primaryAction?: ReactNode; contextLabel?: string
}) {
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; label: string; run: () => void } | null>(null)
  const approved = state.baseline.humanStatus === 'approved'
  const locked = !['editing', 'approved', 'saving'].includes(state.phase) || !allowCommands
  const editing = state.mode === 'edit'
  const busy = ['saving', 'submitting', 'regenerating', 'reconciling'].includes(state.phase)
  const unsettled = state.phase === 'uncertain' || state.phase === 'conflict'
  // 2026-10-03 Human: “导航页和重复说明改进掉”；常规保存/完成只报一次，未知与冲突全文保留。
  const routineNotice = state.notice === '已保存。' || state.notice === '还有新的修改待保存。'
    || approved && state.notice === `${chapterLabel(state.baseline.chapter)}已完成。`
  const saveStatus = state.phase === 'saving' ? '保存中…' : unsettled ? '操作尚未确认，修改已保留。'
    : state.draft.text !== state.baseline.content.text ? '尚有修改未保存。' : '已保存。'
  const [selection, setSelection] = useState<SavedSelection | null>(null)
  const preview = useRef<HTMLDivElement>(null)
  const canMark = allowCommands && ['editing', 'approved'].includes(state.phase) && !state.hasUnknownWrite && state.draft.text === state.baseline.content.text
  const select = (start: number, end: number, text: string) => {
    if (!canMark || start >= end || !text.trim() || state.baseline.content.text.slice(start, end) !== text) return
    setSelection({ chapter: state.baseline.chapter, sourceArtifactId: state.baseline.id, sourceVersion: state.baseline.version, sourceText: state.baseline.content.text, start, end, text })
  }
  const selectPreview = () => {
    const picked = window.getSelection(), root = preview.current
    if (!root || !picked?.rangeCount) return
    const range = picked.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset)
    const start = before.toString().length, text = range.toString(); select(start, start + text.length, text)
  }
  return <MaterialFrame className="setting-review review-page prose-page" headerClassName="prose-header" actionsClassName="prose-header-actions" ariaLabel="正文关卡"
    label={`${chapterLabel(state.baseline.chapter)}${approved ? '已完成' : ''} · 正文`} title={title}
    status={<p className={`prose-meta save-status${unsettled ? ' setting-notice' : ''}`} role="status">{contextLabel && <>{contextLabel} · </>}{saveStatus}</p>}
    actions={<>
        {primaryAction}
        {!approved && <button type="button" style={btnPrimary} disabled={locked || busy} onClick={() => {
          if (state.instructions.trim()) setConfirmation({ title: '通过当前可见正文？', description: '修改意见只用于整章重写。本次只通过当前文字，不会应用修改意见。', label: '仍然通过当前正文', run: onApprove })
          else onApprove()
        }}>通过正文</button>}
        <button type="button" style={btnSecondary} onClick={() => onAction({ type: 'mode', mode: editing ? 'preview' : 'edit' })}>{editing ? '预览正文' : '编辑正文'}</button>
    </>}>
    {state.notice && !routineNotice && <p className={unsettled ? 'setting-notice' : 'setting-muted'} role="status">{state.notice}</p>}
    {busy && state.phase !== 'saving' && <p role="status">{state.phase === 'regenerating' ? '正在整章重写…' : '正在核对结果…'} 当前文字已保留。</p>}
    {!!state.issues.length && <p role="alert" className="setting-field-error">请填写非空正文并检查长度限制。</p>}
    {(state.phase === 'uncertain' || state.phase === 'conflict') && <div className="setting-actions">
      <button type="button" style={btnSecondary} onClick={onConfirm}>核对服务器结果</button>
      {state.recovery?.nextActions.includes('retry-frozen-request') && <button type="button" style={btnSecondary} onClick={onRetry}>重试同一份请求</button>}
      {state.canResume && <button type="button" style={btnPrimary} onClick={() => onAction({ type: 'resume' })}>继续编辑</button>}
      {canLoadServerProse(state) && <button type="button" style={btnSecondary} onClick={() => setConfirmation({ title: '载入服务器正文？', description: '载入会放弃本页修改和意见；已发出的请求可能继续处理。', label: '放弃并载入', run: () => onAction({ type: 'load-server' }) })}>载入服务器正文</button>}
    </div>}
    <section className="setting-section review-body">
      {editing ? <label className="setting-field" htmlFor="prose-text"><span>正文</span><textarea id="prose-text" className="prose-reading prose-editor" rows={24} style={{ ...fieldStyle, fontSize: 'var(--prose-size)', fontFamily: 'var(--font-reading)', lineHeight: 'var(--prose-leading)' }} value={state.draft.text} disabled={locked}
        aria-invalid={state.issues.length > 0 || undefined} onChange={e => onAction({ type: 'text', value: e.target.value })}
        onSelect={e => select(e.currentTarget.selectionStart, e.currentTarget.selectionEnd, e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd))}
        onMouseUp={e => select(e.currentTarget.selectionStart, e.currentTarget.selectionEnd, e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd))} /></label>
        : <div ref={preview} className="prose-reading prose-preview" onMouseUp={selectPreview} onKeyUp={selectPreview}>{state.draft.text}</div>}
      <p className="setting-muted prose-count">{Array.from(state.draft.text).length} 字符 · 写作参考 2000–4000 字</p>
    </section>
    {!approved && <section className="setting-section rewrite-panel" style={cardStyle}>
      <label className="setting-field" htmlFor="prose-instructions"><span>本次修改意见（仅用于整章重写）</span><textarea id="prose-instructions" rows={4} style={fieldStyle} value={state.instructions} disabled={locked}
        onChange={e => onAction({ type: 'instructions', value: e.target.value })} /></label>
      <p className="setting-muted">使用当前编辑文字和意见，遵循已通过章纲。成功才替换整章，失败保留当前文字；意见可留空。</p>
      {state.draft.text.length > proseLimits.text && <p role="alert">正文超过本次请求长度上限。</p>}
      <button type="button" style={btnSecondary} disabled={locked || busy} onClick={() => setConfirmation({ title: '整章重写正文？', description: '成功后替换当前整章文字；取消或失败会保留当前修改和意见。', label: '确认整章重写', run: onRegenerate })}>整章重写</button>
    </section>}
    <BadExamplesPanel key={state.baseline.chapter} workId={state.baseline.workId} chapter={state.baseline.chapter} selection={selection} onClear={() => setSelection(null)} canMark={canMark} onGuard={onBadExampleGuard} />
    {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description} cancelLabel="继续编辑" confirmLabel={confirmation.label}
      onCancel={() => setConfirmation(null)} onConfirm={() => { setConfirmation(null); confirmation.run() }} />}
  </MaterialFrame>
}
