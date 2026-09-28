import { useState } from 'react'
import { proseLimits } from '@agent4novel/contracts'
import type { ProseReviewState, ProseReviewAction } from '../prose-review.js'
import { canLoadServerProse } from '../prose-review.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import { btnPrimary, btnSecondary, cardStyle, fieldStyle } from '../ui.js'

export default function ProseReview({ title, state, onAction, allowCommands, onApprove, onRegenerate, onConfirm, onRetry }: {
  title: string; state: ProseReviewState; onAction: (action: ProseReviewAction) => void; allowCommands: boolean
  onApprove: () => void; onRegenerate: () => void; onConfirm: () => void; onRetry: () => void
}) {
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; label: string; run: () => void } | null>(null)
  const approved = state.baseline.humanStatus === 'approved'
  const locked = !['editing', 'approved', 'saving'].includes(state.phase) || !allowCommands
  const editing = state.mode === 'edit'
  const busy = ['saving', 'submitting', 'regenerating', 'reconciling'].includes(state.phase)
  return <section className="setting-review" aria-label="正文关卡">
    <header className="setting-review-header">
      <div><p className="setting-eyebrow">第一章 · 正文</p><h2>{approved ? '第一章已完成' : title}</h2>
        <p className="setting-muted">{approved ? '本章已通过。修改会自动保存，仍保持已通过。' : '正文修改会自动保存；通过后标记本章完成。'}</p>
        <p role="status">{state.phase === 'saving' ? '保存中…' : ['uncertain', 'conflict'].includes(state.phase) ? '操作尚未确认，修改已保留。'
          : state.draft.text !== state.baseline.content.text ? '尚有修改未保存。' : '已保存。'}</p></div>
      <div className="setting-actions">
        <button type="button" style={btnSecondary} onClick={() => onAction({ type: 'mode', mode: editing ? 'preview' : 'edit' })}>{editing ? '预览正文' : '编辑正文'}</button>
        {!approved && <button type="button" style={btnPrimary} disabled={locked || busy} onClick={() => {
          if (state.instructions.trim()) setConfirmation({ title: '通过当前可见正文？', description: '修改意见只用于整章重写。本次只通过当前文字，不会应用修改意见。', label: '仍然通过当前正文', run: onApprove })
          else onApprove()
        }}>通过正文</button>}
      </div>
    </header>
    {state.notice && <p className="setting-notice" role="status">{state.notice}</p>}
    {busy && state.phase !== 'saving' && <p role="status">{state.phase === 'regenerating' ? '正在整章重写…' : '正在核对结果…'} 当前文字已保留。</p>}
    {!!state.issues.length && <p role="alert" className="setting-field-error">请填写非空正文并检查长度限制。</p>}
    {(state.phase === 'uncertain' || state.phase === 'conflict') && <div className="setting-actions">
      <button type="button" style={btnSecondary} onClick={onConfirm}>核对服务器结果</button>
      {state.recovery?.nextActions.includes('retry-frozen-request') && <button type="button" style={btnSecondary} onClick={onRetry}>重试同一份请求</button>}
      {state.canResume && <button type="button" style={btnPrimary} onClick={() => onAction({ type: 'resume' })}>继续编辑</button>}
      {canLoadServerProse(state) && <button type="button" style={btnSecondary} onClick={() => setConfirmation({ title: '载入服务器正文？', description: '载入会放弃本页修改和意见；已发出的请求可能继续处理。', label: '放弃并载入', run: () => onAction({ type: 'load-server' }) })}>载入服务器正文</button>}
    </div>}
    <section className="setting-section">
      {approved && <h3>{title}</h3>}
      {editing ? <label className="setting-field" htmlFor="prose-text"><span>正文</span><textarea id="prose-text" rows={24} style={fieldStyle} value={state.draft.text} disabled={locked}
        aria-invalid={state.issues.length > 0 || undefined} onChange={e => onAction({ type: 'text', value: e.target.value })} /></label>
        : <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>{state.draft.text}</div>}
      <p className="setting-muted">{Array.from(state.draft.text).length} 字符 · 写作参考 2000–4000 字</p>
    </section>
    {!approved && <section className="setting-section" style={cardStyle}>
      <label className="setting-field" htmlFor="prose-instructions"><span>本次修改意见（仅用于整章重写）</span><textarea id="prose-instructions" rows={4} style={fieldStyle} value={state.instructions} disabled={locked}
        onChange={e => onAction({ type: 'instructions', value: e.target.value })} /></label>
      <p className="setting-muted">使用当前编辑文字和意见，遵循已通过章纲。成功才替换整章，失败保留当前文字；意见可留空。</p>
      {state.draft.text.length > proseLimits.text && <p role="alert">正文超过本次请求长度上限。</p>}
      <button type="button" style={btnSecondary} disabled={locked || busy} onClick={() => setConfirmation({ title: '整章重写正文？', description: '成功后替换当前整章文字；取消或失败会保留当前修改和意见。', label: '确认整章重写', run: onRegenerate })}>整章重写</button>
    </section>}
    {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description} cancelLabel="继续编辑" confirmLabel={confirmation.label}
      onCancel={() => setConfirmation(null)} onConfirm={() => { setConfirmation(null); confirmation.run() }} />}
  </section>
}
