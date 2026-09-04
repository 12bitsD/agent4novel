import type { SettingReviewAction, SettingReviewState } from '../setting-review.js'
import { useEffect, useRef, useState } from 'react'
import { settingCardSections } from '@agent4novel/contracts'
import { settingIssueTarget } from '../setting-review.js'
import { SettingMarkdown } from '../setting-markdown.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import { btnPrimary, btnSecondary, cardStyle, fieldStyle, smallBtnStyle } from '../ui.js'

export type SettingReviewProps = {
  state: SettingReviewState; onAction: (action: SettingReviewAction) => void
  onApprove: () => void; onConfirm: () => void; onRetry: () => void; allowApprove: boolean
}
const labels = { world: '世界与运行规则', characters: '人物', factions: '势力与组织', relationships: '关系' }
export default function SettingReview({ state, onAction, onApprove, onConfirm, onRetry, allowApprove }: SettingReviewProps) {
  const root = useRef<HTMLElement>(null)
  const [confirm, setConfirm] = useState<{ title: string; description: string; label: string; action: SettingReviewAction } | null>(null)
  const approved = state.phase === 'approved'
  const editing = state.mode === 'edit' && !approved
  const locked = state.phase !== 'editing' || !allowApprove
  const busy = state.phase === 'submitting' || state.phase === 'reconciling'
  useEffect(() => {
    if (!state.focusTarget || state.mode !== 'edit') return
    const target = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-setting-field]') ?? [])
      .find((element) => element.dataset.settingField === state.focusTarget)
    target?.focus()
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [state.focusTarget, state.issues, state.mode])
  const errors = (target: string) => state.issues.filter((issue) => settingIssueTarget(state.draft, issue.path) === target)
  const errorNote = (target: string) => errors(target).length > 0
    ? <span id={`setting-error-${target}`} className="setting-field-error" role="alert">{errors(target).map((issue) => issue.message).join('；')}</span> : null
  const input = (target: string, label: string, value: string, multiline: boolean, change: (value: string) => void) => {
    const props = { id: `setting-${target}`, 'data-setting-field': target, value, disabled: locked,
      'aria-invalid': errors(target).length > 0 || undefined, 'aria-describedby': errors(target).length ? `setting-error-${target}` : undefined,
      style: fieldStyle, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value) }
    return <label className="setting-field" htmlFor={props.id}><span>{label}</span>
      {multiline ? <textarea {...props} rows={target === 'overview' ? 8 : 6} /> : <input {...props} />}{errorNote(target)}</label>
  }
  const containers = [
    ...settingCardSections.map((name) => ({ key: name, title: labels[name], items: state.draft[name] })),
    ...state.draft.extensions.map((section) => ({ key: section.localKey, title: section.title || '未命名补充栏目', items: section.items })),
  ]
  const cards = (container: typeof containers[number]) => <>
    {container.items.map((item, index) => <article style={cardStyle} className="setting-card" key={item.localKey}>
      {editing ? <>
        {input(`${item.localKey}:title`, '卡片标题', item.title, false, (value) => onAction({ type: 'edit-item', key: item.localKey, field: 'title', value }))}
        {input(`${item.localKey}:content`, '卡片正文（支持简单 Markdown）', item.content, true, (value) => onAction({ type: 'edit-item', key: item.localKey, field: 'content', value }))}
        <div className="setting-actions">
          <button type="button" style={smallBtnStyle} disabled={locked || index === 0} aria-label={`上移卡片 ${item.title || index + 1}`} onClick={() => onAction({ type: 'reorder-item', key: item.localKey, direction: -1 })}>上移</button>
          <button type="button" style={smallBtnStyle} disabled={locked || index === container.items.length - 1} aria-label={`下移卡片 ${item.title || index + 1}`} onClick={() => onAction({ type: 'reorder-item', key: item.localKey, direction: 1 })}>下移</button>
          <select aria-label={`移动到其他栏目：${item.title || '新卡片'}`} style={smallBtnStyle} disabled={locked} value="" onChange={(event) => onAction({ type: 'move-item', key: item.localKey, target: event.target.value })}>
            <option value="" disabled>移动到其他栏目…</option>
            {containers.filter((target) => target.key !== container.key).map((target) => <option value={target.key} key={target.key}>{target.title}</option>)}
          </select>
          <button type="button" style={smallBtnStyle} disabled={locked} aria-label={`删除卡片 ${item.title || index + 1}`} onClick={() => onAction({ type: 'remove-item', key: item.localKey })}>删除</button>
        </div>
      </> : <><h4>{item.title || '未命名卡片'}</h4><SettingMarkdown source={item.content} /></>}
    </article>)}
    {container.items.length === 0 && <p className="setting-muted">暂无卡片，可按需要补充。</p>}
    {editing && <><button type="button" style={smallBtnStyle} disabled={locked} data-setting-field={`${container.key}:add`} aria-describedby={errors(`${container.key}:add`).length ? `setting-error-${container.key}:add` : undefined}
      onClick={() => onAction({ type: 'add-item', target: container.key })}>＋ 新增卡片</button>{errorNote(`${container.key}:add`)}</>}
  </>
  return <section ref={root} className="setting-review" aria-label="设定关卡">
    <header className="setting-review-header">
      <div><p className="setting-eyebrow">作品基准 · 设定</p><h2>让故事有据可循</h2>
        <p className="setting-muted">{approved ? '这份设定已通过，后续创作将使用此版本。' : '读一遍，补充你的想法，然后通过。修改仅保留在当前页面。'}</p></div>
      <div className="setting-actions">
        {!approved && <button type="button" style={btnSecondary} onClick={() => onAction({ type: 'mode', mode: editing ? 'preview' : 'edit' })}>{editing ? '预览设定' : '编辑设定'}</button>}
        <button type="button" style={btnPrimary} disabled={approved || locked} onClick={onApprove}>{approved ? '已通过' : busy ? '正在确认…' : '通过设定'}</button>
      </div>
    </header>
    {(state.notice || state.issues.length > 0) && <div className="setting-notice" role="status">
      {state.notice || '请检查下方标出的内容，再通过设定。'}
      {state.issues.length > 0 && <ul>{state.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
    </div>}
    {(state.phase === 'uncertain' || state.phase === 'conflict') && <div className="setting-actions setting-recovery">
      <button type="button" style={btnSecondary} onClick={onConfirm}>核对服务器结果</button>
      {state.phase === 'uncertain' && <button type="button" style={btnSecondary} onClick={onRetry}>重试同一份提交</button>}
      {state.canResume && <button type="button" style={btnPrimary} onClick={() => onAction({ type: 'resume' })}>继续编辑</button>}
      {state.remote && <button type="button" style={btnSecondary} onClick={() => setConfirm({ title: '放弃本页修改？', description: '本页修改将被丢弃，并加载服务器上的设定。此操作不会撤销已经发送的通过请求。', label: '放弃并加载远端', action: { type: 'discard-load', artifact: state.remote! } })}>加载服务器设定</button>}
    </div>}
    <section className="setting-section"><h3>设定总览</h3>
      {editing ? input('overview', '设定总览（支持简单 Markdown）', state.draft.overview, true, (value) => onAction({ type: 'overview', value })) : <SettingMarkdown source={state.draft.overview} />}
    </section>
    {settingCardSections.map((name) => <section className="setting-section" key={name}><h3>{labels[name]}</h3>{cards(containers.find((container) => container.key === name)!)}</section>)}
    <section className="setting-section"><h3>补充设定</h3>
      {state.draft.extensions.map((section, index) => <section className="setting-extension" key={section.localKey}>
        {editing ? <>
          {input(`${section.localKey}:title`, '补充栏目名称', section.title, false, (value) => onAction({ type: 'rename-section', key: section.localKey, value }))}
          <div className="setting-actions">
            <button type="button" style={smallBtnStyle} disabled={locked || index === 0} onClick={() => onAction({ type: 'reorder-section', key: section.localKey, direction: -1 })}>上移栏目</button>
            <button type="button" style={smallBtnStyle} disabled={locked || index === state.draft.extensions.length - 1} onClick={() => onAction({ type: 'reorder-section', key: section.localKey, direction: 1 })}>下移栏目</button>
            <button type="button" style={smallBtnStyle} disabled={locked} onClick={() => {
              const action: SettingReviewAction = { type: 'remove-section', key: section.localKey }
              if (section.items.length) setConfirm({ title: '删除这个补充栏目？', description: '栏目及其中的卡片会从当前草稿移除。设定通过前不会写入服务器。', label: '删除栏目与卡片', action })
              else onAction(action)
            }}>删除栏目</button>
          </div>
        </> : <h4>{section.title || '未命名补充栏目'}</h4>}
        {cards(containers.find((container) => container.key === section.localKey)!)}
      </section>)}
      {state.draft.extensions.length === 0 && <p className="setting-muted">没有额外的补充栏目。</p>}
      {editing && <button type="button" style={smallBtnStyle} disabled={locked} data-setting-field="extensions" onClick={() => onAction({ type: 'add-section' })}>＋ 新增补充栏目</button>}
      {errorNote('extensions')}
    </section>
    {confirm && <ConfirmDialog title={confirm.title} description={confirm.description} cancelLabel="继续编辑" confirmLabel={confirm.label}
      onCancel={() => setConfirm(null)} onConfirm={() => { onAction(confirm.action); setConfirm(null) }} />}
  </section>
}
