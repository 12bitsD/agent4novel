import { useEffect, useRef, useState } from 'react'
import { creativeContentSchema, type Artifact, type CaptionContent, type CreativeContent } from '@agent4novel/contracts'
import { getWork, saveCreativeDraft, selectCreativeDirection } from '../api.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import MaterialFrame, { type MaterialGuard } from '../MaterialFrame.js'
import { materialWriteUnconfirmed } from '../material-operation.js'
import {
  activePack,
  beginSave,
  beginSelect,
  commandFailed,
  editActive,
  initCompare,
  isDirty,
  savePayload,
  saveSucceeded,
  selectSucceeded,
  switchTab,
} from '../creative-compare.js'
import type { CompareState } from '../creative-compare.js'
import { btnPrimary, btnSecondary, cardStyle, chipStyle, fieldStyle, tabStyle } from '../ui.js'

// —— 小编辑器(全走本地缓存,不直达 server)——

function StringChipsEditor({
  items,
  onChange,
  readonly,
  label,
}: {
  items: string[]
  onChange: (items: string[]) => void
  readonly: boolean
  label: string
}) {
  if (readonly) {
    return (
      <span>
        {items.map((t, i) => (
          <span key={i} style={{ ...chipStyle('accent'), marginRight: 6 }}>{t}</span>
        ))}
      </span>
    )
  }
  return (
    <span className="chip-editor">
      {items.map((t, i) => (
        <input
          key={i}
          aria-label={`${label} ${i + 1}`}
          value={t}
          onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          style={{ ...fieldStyle, width: 120, display: 'inline-block', marginRight: 6, padding: '2px 8px' }}
        />
      ))}
      <button aria-label={`添加${label}`} onClick={() => onChange([...items, ''])} style={{ ...btnSecondary, padding: '2px 10px', fontSize: 13 }}>
        ＋
      </button>
    </span>
  )
}

function HintListEditor({
  items,
  onChange,
  readonly,
  label,
}: {
  items: { title: string; content: string }[]
  onChange: (items: { title: string; content: string }[]) => void
  readonly: boolean
  label: string
}) {
  if (readonly) {
    return (
      <div className="hint-grid">
        {items.map((it, i) => (
          <div key={i} style={{ ...cardStyle, padding: 14 }}>
            <strong style={{ fontSize: 13 }}>{it.title}</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{it.content}</p>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="hint-editor">
          <input
            aria-label={`${label} ${i + 1} 标题`}
            value={it.title}
            placeholder="标题"
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
            }
            style={fieldStyle}
          />
          <textarea
            aria-label={`${label} ${i + 1} 内容`}
            rows={2}
            value={it.content}
            placeholder="内容"
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
            }
            style={fieldStyle}
          />
          <button
            aria-label={`删除${label} ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{ ...btnSecondary, padding: '2px 10px', fontSize: 13 }}
          >
            删
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, { title: '', content: '' }])}
        style={{ ...btnSecondary, padding: '2px 10px', fontSize: 13, marginTop: 8 }}
      >
        ＋添加
      </button>
    </div>
  )
}

// —— 创意海报(全页比较视图,#3c)——

export default function CreativePoster({
  workId,
  content,
  headVersion,
  caption,
  readonly: viewReadonly,
  onChanged,
  onSelected,
  onGuard,
}: {
  workId: string
  content: CreativeContent
  headVersion: number
  caption: CaptionContent | null
  /** 只读展示(当前链路选定后即离开海报,保留给未来回溯场景) */
  readonly: boolean
  onChanged: () => void
  /** 选定成功后调用(#4:Workspace 借此自动续跑 advance 生成大纲) */
  onSelected?: () => void
  onGuard?: (guard: MaterialGuard) => void
}) {
  const [s, setS] = useState<CompareState>(() => initCompare(content, headVersion))
  const [captionOpen, setCaptionOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectCandidate, setSelectCandidate] = useState<CompareState | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [remote, setRemote] = useState<Artifact | null>(null)
  const [loadCandidate, setLoadCandidate] = useState<Artifact | null>(null)
  const [observedApproved, setObservedApproved] = useState(false)
  const active = useRef(false), operationSequence = useRef(0), commandBusy = useRef(false)
  const frozenOperation = useRef<unknown>(null)
  const observedReadonlyContent = useRef<string | null>(null)
  const externalReadonlyDraft = viewReadonly && !observedApproved && isDirty(s)
  const readonly = observedApproved || (viewReadonly && !externalReadonlyDraft)
  const locked = s.saving || s.selecting || unconfirmed || checking
  useEffect(() => { active.current = true; return () => { active.current = false; operationSequence.current++ } }, [workId])

  // Approved head changes are read-only observations; saved editable drafts keep their mounted controls.
  useEffect(() => {
    if (!viewReadonly || externalReadonlyDraft || unconfirmed || s.saving || s.selecting) return
    const identity = JSON.stringify({ content, headVersion })
    if (observedReadonlyContent.current === identity) return
    observedReadonlyContent.current = identity
    setS(initCompare(content, headVersion))
  }, [viewReadonly, externalReadonlyDraft, unconfirmed, s.saving, s.selecting, content, headVersion])

  const pack = activePack(s)
  useEffect(() => { onGuard?.({ dirty: !observedApproved && isDirty(s), locked: s.saving || s.selecting || unconfirmed || checking }) }, [s, viewReadonly, observedApproved, unconfirmed, checking, onGuard])
  useEffect(() => () => onGuard?.({ dirty: false, locked: false }), [onGuard])

  const doSave = async () => {
    if (readonly || externalReadonlyDraft || unconfirmed || checking || commandBusy.current) return
    const next = beginSave(s); if (next === s) return
    const sequence = ++operationSequence.current
    commandBusy.current = true; frozenOperation.current = { operation: 'save-creative', expectedHeadVersion: next.headVersion, content: savePayload(next) }
    onGuard?.({ dirty: isDirty(next), locked: true }); setS(next); setError(null)
    try {
      const result = await saveCreativeDraft(workId, savePayload(next), next.headVersion)
      if (!active.current || sequence !== operationSequence.current) return
      setS(current => saveSucceeded(current, result.version)); frozenOperation.current = null
    } catch (error) {
      if (!active.current || sequence !== operationSequence.current) return
      const unknown = materialWriteUnconfirmed(error); setUnconfirmed(unknown)
      setS(current => commandFailed(current, (error as { code?: string }).code))
      setError(unknown ? '操作结果尚未确认，编辑和原提交仍保留。请先核对服务器内容。' : '保存被拒或失败，你的编辑仍保留。')
    } finally { if (active.current && sequence === operationSequence.current) commandBusy.current = false }
  }

  const doSelect = async (candidate: CompareState) => {
    if (readonly || externalReadonlyDraft || unconfirmed || checking || commandBusy.current || s.saving || s.selecting) return
    const next = beginSelect(candidate); if (next === candidate) return
    const sequence = ++operationSequence.current
    commandBusy.current = true; frozenOperation.current = { operation: 'select-creative', directionId: next.activeId, expectedHeadVersion: next.headVersion, content: savePayload(next) }
    onGuard?.({ dirty: isDirty(next), locked: true }); setS(next); setError(null)
    try {
      let head = next.headVersion
      if (isDirty(next)) {
        const result = await saveCreativeDraft(workId, savePayload(next), head)
        if (!active.current || sequence !== operationSequence.current) return
        head = result.version
      }
      frozenOperation.current = { operation: 'select-creative', directionId: next.activeId, expectedHeadVersion: head }
      await selectCreativeDirection(workId, next.activeId, head)
      if (!active.current || sequence !== operationSequence.current) return
      frozenOperation.current = null; setS(current => selectSucceeded(current)); setObservedApproved(true)
      onGuard?.({ dirty: false, locked: false })
      if (onSelected) onSelected(); else onChanged()
    } catch (error) {
      if (!active.current || sequence !== operationSequence.current) return
      const unknown = materialWriteUnconfirmed(error); setUnconfirmed(unknown)
      setS(current => commandFailed(current, (error as { code?: string }).code))
      setError(unknown ? '操作结果尚未确认，编辑和原提交仍保留。请先核对服务器内容。' : '选定被拒或失败，你的编辑仍保留。')
    } finally { if (active.current && sequence === operationSequence.current) commandBusy.current = false }
  }

  const readCurrent = async () => {
    if (commandBusy.current) return
    const sequence = ++operationSequence.current; commandBusy.current = true; setChecking(true)
    try {
      const view = await getWork(workId)
      if (!active.current || sequence !== operationSequence.current) return
      const found = view.artifacts.find(item => item.kind === 'creative')
      if (found) setRemote(found); else setError('暂未取得可核对的创意稿，请保留本页。')
    } catch { if (active.current && sequence === operationSequence.current) setError('核对读取失败，原提交和编辑仍保留。') }
    finally { if (active.current && sequence === operationSequence.current) { commandBusy.current = false; setChecking(false) } }
  }

  return (
    <MaterialFrame className="creative-review" ariaLabel="创意稿关卡" label="全书 · 创意稿" title="找到故事的起点"
      description={<p className="page-lede">比较方向、修改内容并选定。选定后继续生成大纲。</p>}
      status={externalReadonlyDraft ? <p role="status" className="setting-notice">服务器内容已变化，本页编辑已保留。请核对后决定是否载入。</p> : viewReadonly || observedApproved ? <p className="setting-muted" role="status">当前方向已选定，只读参阅。</p> : <>
          <span className="review-save-state" role="status">
            {s.saving ? '保存中……' : isDirty(s) ? '有未保存的修改' : s.notice === '已保存' ? '已保存' : '编辑当前方向后可保存'}
          </span>
      </>}
      actions={!readonly && !externalReadonlyDraft && !unconfirmed && <>
          {isDirty(s) && (
            <button
              onClick={doSave}
              disabled={s.saving || s.selecting}
              style={btnSecondary}
            >
              {s.saving ? '保存中……' : '保存全部方向'}
            </button>
          )}
          <button
            onClick={() => setSelectCandidate(s)}
            disabled={s.saving || s.selecting}
            style={btnPrimary}
          >
            {s.selecting ? '选定中……' : `就按「${pack.title}」这个方向写 →`}
          </button>
      </>}>
      {/* 2026-10-03：B+C 视觉对齐；方向选择保留普通按钮语义，不模拟缺少键盘协议的 tabs。 */}
      <div role="group" aria-label="创作方向" className="choice-row">
        {s.packs.map((p) => {
          const active = p.directionId === s.activeId
          return (
            <button
              key={p.directionId}
              aria-pressed={active}
              disabled={locked || externalReadonlyDraft}
              onClick={() => setS((cur) => switchTab(cur, p.directionId))}
              style={tabStyle(active)}
            >
              {s.drafts[p.directionId]?.title || p.title}
            </button>
          )
        })}
      </div>

      {s.conflict && (
        <p className="status-message" role="alert">
          内容已在别处更新(409),你的编辑保留在原处;刷新后可基于最新版继续。
        </p>
      )}
      {error && <p role="alert" className="status-message status-error">{error}</p>}
      {s.notice && s.notice !== '已保存' && <p role="status" className="status-message">{s.notice}</p>}

      {/* 海报主体 */}
      <fieldset className="material-edit-fields" disabled={locked || externalReadonlyDraft}>
      <section className="flow-section surface">
        <p className="field-label">方向标题</p>
        {readonly ? (
          <h2 style={{ marginTop: 0 }}>{pack.title}</h2>
        ) : (
          <input
            aria-label="方向标题"
            value={pack.title}
            onChange={(e) => setS((cur) => editActive(cur, { title: e.target.value }))}
            style={{ ...fieldStyle, fontSize: 22, fontWeight: 700, marginBottom: 8 }}
          />
        )}

        <p className="section-heading">钩子</p>
        {readonly ? (
          <p style={{ fontSize: 16 }}>{pack.hook}</p>
        ) : (
          <textarea
            aria-label="钩子"
            rows={2}
            value={pack.hook}
            onChange={(e) => setS((cur) => editActive(cur, { hook: e.target.value }))}
            style={{ ...fieldStyle, fontSize: 16 }}
          />
        )}

        <p className="section-heading">题材标签</p>
        <StringChipsEditor
          label="题材标签"
          items={pack.tags}
          readonly={readonly}
          onChange={(tags) => setS((cur) => editActive(cur, { tags }))}
        />

        <p className="section-heading">梗概</p>
        {readonly ? (
          <p style={{ whiteSpace: 'pre-wrap' }}>{pack.synopsis}</p>
        ) : (
          <textarea
            aria-label="梗概"
            rows={5}
            value={pack.synopsis}
            onChange={(e) => setS((cur) => editActive(cur, { synopsis: e.target.value }))}
            style={fieldStyle}
          />
        )}

        <p className="section-heading">人物</p>
        <HintListEditor
          label="人物"
          items={pack.characters}
          readonly={readonly}
          onChange={(characters) => setS((cur) => editActive(cur, { characters }))}
        />

        <p className="section-heading">设定</p>
        <HintListEditor
          label="设定"
          items={pack.setting}
          readonly={readonly}
          onChange={(setting) => setS((cur) => editActive(cur, { setting }))}
        />

        <p className="section-heading">爽点</p>
        <StringChipsEditor
          label="爽点"
          items={pack.payoffs}
          readonly={readonly}
          onChange={(payoffs) => setS((cur) => editActive(cur, { payoffs }))}
        />

        <p className="section-heading">大纲走向</p>
        <HintListEditor
          label="大纲走向"
          items={pack.outline}
          readonly={readonly}
          onChange={(outline) => setS((cur) => editActive(cur, { outline }))}
        />
      </section>
      </fieldset>

      {/* 素材理解(caption 只读折叠区) */}
      {caption && (
        <section style={{ marginTop: 16 }}>
          <button
            onClick={() => setCaptionOpen((v) => !v)}
            aria-expanded={captionOpen}
            style={{ ...btnSecondary, padding: '6px 14px', fontSize: 13 }}
          >
            {captionOpen ? '▾' : '▸'} 素材理解(提炼稿)
          </button>
          {captionOpen && (
            <div style={{ ...cardStyle, marginTop: 8, background: 'var(--bg-sunken)' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                输入阶段:{caption.inputStage}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{caption.summary}</p>
              {caption.elements.map((el, i) => (
                <p key={i} style={{ margin: '4px 0', fontSize: 13 }}>
                  <strong>{el.kind}</strong>:{el.content}
                </p>
              ))}
              {caption.gaps.length > 0 && (
                <p style={{ fontSize: 13, color: 'var(--warn-ink)' }}>
                  缺口:{caption.gaps.join(';')}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {(unconfirmed || s.conflict || externalReadonlyDraft) && <section className="setting-recovery" aria-label="操作结果核对">
        <button type="button" style={btnSecondary} disabled={checking} onClick={() => void readCurrent()}>核对服务器内容</button>
        {remote && <><p role="status">服务器当前版本 v{remote.version}，这是当前状态观察，不是原操作回执。</p>
          <details><summary>查看服务器材料</summary>{creativeContentSchema.parse(remote.content).directions.map(item => <div key={item.directionId}><h3>{item.title}</h3><p>{item.synopsis}</p></div>)}</details>
          <button type="button" style={btnSecondary} onClick={() => setLoadCandidate(remote)}>载入服务器内容</button></>}
      </section>}
      {loadCandidate && <ConfirmDialog title="载入服务器内容？" description="载入会放弃本页编辑，采用服务器当前版本。已经发出的操作可能继续处理，此操作不会撤销它。" cancelLabel="继续编辑" confirmLabel="放弃本页并载入" onCancel={() => setLoadCandidate(null)} onConfirm={() => {
        operationSequence.current++; commandBusy.current = false; frozenOperation.current = null
        setS(initCompare(creativeContentSchema.parse(loadCandidate.content), loadCandidate.version)); setObservedApproved(loadCandidate.humanStatus === 'approved')
        setLoadCandidate(null); setUnconfirmed(false); setRemote(null); setError(null); onChanged()
      }} />}
      {selectCandidate && (
        <ConfirmDialog
          title="选定创作方向"
          description={`就按「${activePack(selectCandidate).title}」这个方向写?选定后其余方向留在历史版本里。`}
          cancelLabel="继续编辑"
          confirmLabel="确认选定"
          onCancel={() => setSelectCandidate(null)}
          onConfirm={() => {
            // 复用可访问确认；提交的方向、草稿和版本仍是打开弹窗时的同一份内容。
            setSelectCandidate(null)
            void doSelect(selectCandidate)
          }}
        />
      )}
    </MaterialFrame>
  )
}
