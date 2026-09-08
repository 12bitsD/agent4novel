import type { BeatReviewAction, BeatReviewState } from '../beat-review.js'
import { canLoadServerBeat } from '../beat-review.js'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { beatLimits } from '@agent4novel/contracts'
import { FiniteMarkdown } from '../finite-markdown.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import { btnPrimary, btnSecondary, cardStyle, fieldStyle, smallBtnStyle } from '../ui.js'
export default function BeatReview({ state, onAction, allowCommands, onApprove, onRegenerate, onConfirm, onRetry }: {
  state: BeatReviewState; onAction: (action: BeatReviewAction) => void; allowCommands: boolean
  onApprove: () => void; onRegenerate: () => void; onConfirm: () => void; onRetry: () => void
}) {
  const root = useRef<HTMLElement>(null)
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; label: string; run: () => void } | null>(null)
  const approved = state.phase === 'approved'
  const editing = state.mode === 'edit' && !approved
  const locked = state.phase !== 'editing' || !allowCommands
  const busy = ['submitting', 'regenerating', 'reconciling'].includes(state.phase)
  const issuePath = (path: Array<string | number>) => (path[0] === 'content' ? path.slice(1) : path).join('.')
  useEffect(() => {
    if (!state.issues.length || state.mode !== 'edit') return
    const path = issuePath(state.issues[0]!.path)
    const element = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-beat-path]') ?? []).find(e => e.dataset.beatPath === path)
    element?.focus()
    element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [state.issues, state.mode])
  const markdown = (source: string) => <FiniteMarkdown source={source} maxChars={beatLimits.text} />
  const field = (path: string, label: string, value: string, multiline: boolean, change: (value: string) => void) => {
    const errors = state.issues.filter(issue => issuePath(issue.path) === path)
    const props = { id: `beat-${path}`, 'data-beat-path': path, value, disabled: locked, style: fieldStyle,
      'aria-invalid': errors.length > 0 || undefined, 'aria-describedby': errors.length ? `beat-error-${path}` : undefined,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
    }
    return <label className="setting-field" htmlFor={props.id}><span>{label}</span>
      {multiline ? <textarea {...props} rows={5} /> : <input {...props} />}
      {errors.length > 0 && <span id={`beat-error-${path}`} className="setting-field-error" role="alert">{errors.map(e => e.message).join('；')}</span>}
    </label>
  }
  return <section ref={root} className="setting-review" aria-label="章纲关卡">
    <header className="setting-review-header">
      <div><p className="setting-eyebrow">第一章 · 写作计划</p><h2>{approved ? '章纲已通过' : '先看清这一章，再开始写作'}</h2>
        <p className="setting-muted">{approved ? '后续正文将使用这份章纲。本期不生成正文。' : '修改仅保存在当前页面；点击通过后，一次定稿。'}</p></div>
      {!approved && <div className="setting-actions">
        <button type="button" style={btnSecondary} onClick={() => onAction({ type: 'mode', mode: editing ? 'preview' : 'edit' })}>{editing ? '预览章纲' : '编辑章纲'}</button>
        <button type="button" disabled={locked} style={btnPrimary} onClick={() => {
          if (state.instructions.trim()) setConfirmation({ title: '通过当前可见的章纲？', description: '修改意见仅用于重新生成。本次只通过当前可见章纲，不会应用这些修改意见。', label: '仍然通过当前章纲', run: onApprove })
          else onApprove()
        }}>通过章纲</button>
      </div>}
    </header>
    {state.notice && <p className="setting-notice" role="status">{state.notice}</p>}
    {busy && <p role="status">{state.phase === 'regenerating' ? '正在重新生成整份章纲…' : '正在确认结果…'} 当前内容已保留。</p>}
    {state.issues.length > 0 && <div className="setting-notice" role="alert">请检查标出的字段后再提交。<ul>{state.issues.map((issue, i) => <li key={i}>{issuePath(issue.path)}：{issue.message}</li>)}</ul></div>}
    {(state.phase === 'uncertain' || state.phase === 'conflict') && <div className="setting-actions setting-recovery">
      <button type="button" style={btnSecondary} onClick={onConfirm}>核对服务器结果</button>
      {state.recovery?.nextActions.includes('retry-frozen-request') && <button type="button" style={btnSecondary} onClick={onRetry}>重试同一份请求</button>}
      {state.canResume && <button type="button" style={btnPrimary} onClick={() => onAction({ type: 'resume' })}>继续编辑</button>}
      {canLoadServerBeat(state) && <button type="button" style={btnSecondary} onClick={() => setConfirmation({ title: '载入服务器版本？', description: '载入将放弃本页修改和意见；已发送的请求可能继续处理。', label: '放弃并载入', run: () => onAction({ type: 'load-server' }) })}>载入服务器章纲</button>}
    </div>}
    <section className="setting-section">
      {editing ? field('title', '章标题', state.draft.title, false, value => onAction({ type: 'field', field: 'title', value })) : <h3>{state.draft.title || '未命名章节'}</h3>}
      <h3>本章目标</h3>{editing ? field('goal', '本章目标（支持简单 Markdown）', state.draft.goal, true, value => onAction({ type: 'field', field: 'goal', value })) : markdown(state.draft.goal)}
    </section>
    <section className="setting-section"><h3>写作安排</h3>
      {state.draft.writingPlan.map((item, i) => <article key={item.localKey} className="setting-card" style={cardStyle}>
        {editing ? <>
          {field(`writingPlan.${i}.title`, `安排 ${i + 1} 标题`, item.title, false, value => onAction({ type: 'item', key: item.localKey, field: 'title', value }))}
          {field(`writingPlan.${i}.content`, `安排 ${i + 1} 说明（支持简单 Markdown）`, item.content, true, value => onAction({ type: 'item', key: item.localKey, field: 'content', value }))}
          <div className="setting-actions">
            <button type="button" style={smallBtnStyle} disabled={locked || i === 0} onClick={() => onAction({ type: 'move-item', key: item.localKey, direction: -1 })}>上移</button>
            <button type="button" style={smallBtnStyle} disabled={locked || i === state.draft.writingPlan.length - 1} onClick={() => onAction({ type: 'move-item', key: item.localKey, direction: 1 })}>下移</button>
            <button type="button" style={smallBtnStyle} disabled={locked} onClick={() => {
              const run = () => onAction({ type: 'remove-item', key: item.localKey })
              if (item.title.trim() || item.content.trim()) setConfirmation({ title: '删除这张安排卡片？', description: '卡片将从本页草稿移除，尚未修改服务器。', label: '删除卡片', run })
              else run()
            }}>删除</button>
          </div>
        </> : <><h4>{i + 1}. {item.title || '未命名安排'}</h4>{markdown(item.content)}</>}
      </article>)}
      {!state.draft.writingPlan.length && <p className="setting-muted">尚无写作安排；请新增卡片，或让 AI 重新生成。</p>}
      {editing && <button type="button" data-beat-path="writingPlan" style={btnSecondary} disabled={locked} onClick={() => onAction({ type: 'add-item' })}>＋ 新增安排</button>}
    </section>
    <section className="setting-section"><h3>章末落点与承接</h3>
      {editing ? field('ending', '章末落点与承接（支持简单 Markdown）', state.draft.ending, true, value => onAction({ type: 'field', field: 'ending', value })) : markdown(state.draft.ending)}
    </section>
    {!approved && <section className="setting-section" style={{ ...cardStyle, background: 'var(--bg-sunken)' }}>
      <h3>需要另一个安排？</h3><p className="setting-muted">修改意见仅用于重新生成，可留空。整份生成成功后才替换当前内容。</p>
      {field('instructions', '本次修改意见（仅用于重新生成）', state.instructions, true, value => onAction({ type: 'instructions', value }))}
      <button type="button" style={btnSecondary} disabled={locked} onClick={() => setConfirmation({ title: '重新生成整份章纲？',
        description: '将根据当前内容与意见重新生成整份章纲，成功后替换当前内容；失败会保留你的修改。', label: '确认重新生成', run: onRegenerate,
      })}>重新生成整份章纲</button>
    </section>}
    {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description} cancelLabel="继续编辑" confirmLabel={confirmation.label}
      onCancel={() => setConfirmation(null)} onConfirm={() => { setConfirmation(null); confirmation.run() }} />}
  </section>
}
