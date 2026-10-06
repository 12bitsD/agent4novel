import { useEffect, useRef, useState } from 'react'
import { outlineContentSchema } from '@agent4novel/contracts'
import type { Artifact, CreativePack, OutlineContent } from '@agent4novel/contracts'
import { approveOutline, getWork, saveOutlineDraft } from '../api.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import MaterialFrame, { type MaterialGuard } from '../MaterialFrame.js'
import { materialWriteUnconfirmed } from '../material-operation.js'
import { btnPrimary, btnSecondary, cardStyle, chipStyle, fieldStyle, smallBtnStyle } from '../ui.js'
import {
  addArc,
  addSegment,
  approveSucceeded,
  beginApprove,
  beginSave,
  commandFailed,
  editArc,
  editSegment,
  initReview,
  isDirty,
  moveArc,
  moveSegment,
  removeArc,
  removeSegment,
  savePayload,
  saveSucceeded,
} from '../outline-review.js'
import type { ReviewState } from '../outline-review.js'

// 大纲 review 视图(#4):弧线时间线卡片 + 剧情点行内列表。
// 所有编辑走 outline-review 纯命令;保存 = 草稿 pending;「通过」= 显式作者可见版本的专用命令。
export default function OutlineReview(props: {
  workId: string
  artifactId?: string
  content: OutlineContent
  headVersion: number
  /** 选定的方向包(顶部摘要,只读) */
  pack: CreativePack | null
  /** outline-approved 态:只读展示 */
  readonly: boolean
  onChanged: () => void
  onApproved?: () => void
  onGuard?: (guard: MaterialGuard) => void
}) {
  const { workId, pack, readonly: viewReadonly, onChanged, onGuard } = props
  const [s, setS] = useState<ReviewState>(() => initReview(props.content, props.headVersion, props.artifactId))
  const [error, setError] = useState<string | null>(null)
  const [packOpen, setPackOpen] = useState(false)
  const [approveCandidate, setApproveCandidate] = useState<ReviewState | null>(null)
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
  const locked = s.saving || s.approving || unconfirmed || checking
  useEffect(() => { active.current = true; return () => { active.current = false; operationSequence.current++ } }, [workId])
  useEffect(() => { onGuard?.({ dirty: !observedApproved && isDirty(s), locked }) }, [s, observedApproved, locked, onGuard])
  useEffect(() => () => onGuard?.({ dirty: false, locked: false }), [onGuard])

  useEffect(() => {
    if (!viewReadonly || externalReadonlyDraft || locked || props.headVersion < s.headVersion) return
    const identity = JSON.stringify({ content: props.content, version: props.headVersion, id: props.artifactId })
    if (observedReadonlyContent.current === identity) return
    observedReadonlyContent.current = identity
    setS(initReview(props.content, props.headVersion, props.artifactId))
  }, [viewReadonly, externalReadonlyDraft, locked, props.content, props.headVersion, props.artifactId, s.headVersion])

  const failCommand = (error: unknown) => {
    const unknown = materialWriteUnconfirmed(error)
    setUnconfirmed(unknown)
    setS(current => commandFailed(current, (error as { code?: string })?.code))
    setError(unknown ? '操作结果尚未确认，编辑和原提交仍保留。请先核对服务器内容。' : '操作被拒或失败，你的编辑仍保留。')
  }

  const doSave = async (state: ReviewState): Promise<ReviewState | null> => {
    if (readonly || externalReadonlyDraft || unconfirmed || checking || commandBusy.current) return null
    const next = beginSave(state)
    if (next === state) return state
    const sequence = ++operationSequence.current
    commandBusy.current = true
    frozenOperation.current = { operation: 'save-outline', expectedHeadVersion: next.headVersion, content: savePayload(next) }
    onGuard?.({ dirty: isDirty(next), locked: true }); setS(next); setError(null)
    try {
      const result = await saveOutlineDraft(workId, savePayload(next), next.headVersion)
      if (!active.current || sequence !== operationSequence.current) return null
      const saved = saveSucceeded(next, outlineContentSchema.parse(result.content), result.version, result.id)
      setS(saved); frozenOperation.current = null
      return saved
    } catch (error) {
      if (active.current && sequence === operationSequence.current) failCommand(error)
      return null
    } finally { if (active.current && sequence === operationSequence.current) commandBusy.current = false }
  }

  const doApprove = async (candidate: ReviewState) => {
    if (readonly || externalReadonlyDraft || locked || commandBusy.current) return
    let current = candidate
    if (isDirty(current)) {
      const saved = await doSave(current)
      if (!saved || !active.current) return
      current = saved
    }
    if (!current.headArtifactId) { setError('无法核对当前大纲身份，请重新打开作品后再通过。'); return }
    const next = beginApprove(current)
    if (next === current) return
    const sequence = ++operationSequence.current
    commandBusy.current = true
    const request = { expectedArtifactId: current.headArtifactId, expectedHeadVersion: current.headVersion }
    frozenOperation.current = { operation: 'approve-outline', ...request }
    onGuard?.({ dirty: isDirty(next), locked: true }); setS(next); setError(null)
    try {
      await approveOutline(workId, request)
      if (!active.current || sequence !== operationSequence.current) return
      frozenOperation.current = null; setS(state => approveSucceeded(state)); setObservedApproved(true)
      onGuard?.({ dirty: false, locked: false })
      if (props.onApproved) props.onApproved(); else onChanged()
    } catch (error) { if (active.current && sequence === operationSequence.current) failCommand(error) }
    finally { if (active.current && sequence === operationSequence.current) commandBusy.current = false }
  }

  const readCurrent = async () => {
    if (commandBusy.current) return
    const sequence = ++operationSequence.current; commandBusy.current = true; setChecking(true)
    try {
      const view = await getWork(workId)
      if (!active.current || sequence !== operationSequence.current) return
      const found = view.artifacts.find(item => item.kind === 'outline')
      if (found) setRemote(found); else setError('暂未取得可核对的大纲，请保留本页。')
    } catch { if (active.current && sequence === operationSequence.current) setError('核对读取失败，原提交和编辑仍保留。') }
    finally { if (active.current && sequence === operationSequence.current) { commandBusy.current = false; setChecking(false) } }
  }

  const label = (text: string) => (
    <div className="field-label">{text}</div>
  )

  return (
    <MaterialFrame className="outline-review" ariaLabel="大纲关卡" label="全书 · 大纲" title="梳理故事的走向"
      description={<p className="page-lede">以弧线组织冲突，以剧情点安排变化。通过后继续生成设定。</p>}
      status={externalReadonlyDraft ? <p role="status" className="setting-notice">服务器内容已变化，本页编辑已保留。请核对后决定是否载入。</p> : readonly ? <p className="setting-muted" role="status">这份大纲已通过，只读参阅。</p> : <>
          <span className="review-save-state" role="status">
            {s.saving ? '保存中……' : isDirty(s) ? '有未保存的修改' : s.notice === '已保存' ? '已保存' : '通过前可编辑大纲'}
          </span>
      </>} actions={!readonly && !externalReadonlyDraft && !unconfirmed && <>
          {isDirty(s) && (
            <button
              onClick={() => void doSave(s)}
              disabled={s.saving || s.approving}
              style={btnSecondary}
            >
              {s.saving ? '保存中……' : '保存草稿'}
            </button>
          )}
          <button
            onClick={() => setApproveCandidate(s)}
            disabled={s.saving || s.approving}
            style={btnPrimary}
          >
            {s.approving ? '通过中……' : '通过大纲 →'}
          </button>
      </>}>
      {/* 顶部:选定方向速览窄条(可折叠) */}
      {pack && (
        <section style={{ ...cardStyle, marginBottom: 16, background: 'var(--bg-sunken)' }}>
          <button
            onClick={() => setPackOpen((v) => !v)}
            aria-expanded={packOpen}
            style={{ ...smallBtnStyle, border: 'none', background: 'none', padding: 0 }}
          >
            {packOpen ? '▾' : '▸'} 选定方向:{pack.title}
          </button>
          {pack.tags.map((t) => (
            <span key={t} style={{ ...chipStyle('accent'), marginLeft: 8 }}>
              {t}
            </span>
          ))}
          {packOpen && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '4px 0' }}>{pack.hook}</p>
              <p style={{ margin: '4px 0', color: 'var(--ink-2)', fontSize: 13 }}>{pack.synopsis}</p>
            </div>
          )}
        </section>
      )}

      {/* 提示条 */}
      {s.conflict && (
        <p className="status-message" role="alert">
          内容已在别处更新(409),你的编辑保留在原处;刷新后可基于最新版继续。
        </p>
      )}
      {error && <p className="status-message status-error" role="alert">{error}</p>}
      {s.notice && s.notice !== '已保存' && <p className="status-message" role="status">{s.notice}</p>}

      {/* 弧线时间线 */}
      <fieldset className="material-edit-fields" disabled={locked || externalReadonlyDraft}>
      {s.draft.arcs.map((arc, ai) => {
        return (
          <section
            key={arc.arcId ?? `new-arc-${ai}`}
            className="flow-section surface"
            style={{ marginBottom: 24 }}
          >
            <p className="eyebrow">弧线 {String(ai + 1).padStart(2, '0')}</p>
            {readonly ? (
              <h2 style={{ margin: '0 0 8px' }}>{arc.title}</h2>
            ) : (
              <div className="editor-title-row">
                <input
                  aria-label={`弧线 ${ai + 1} 标题`}
                  value={arc.title}
                  placeholder="弧线名(如:退婚之辱)"
                  onChange={(e) => setS((cur) => editArc(cur, ai, { title: e.target.value }))}
                  style={{ ...fieldStyle, fontSize: 18, fontWeight: 600 }}
                />
                <div className="editor-tools">
                  <button aria-label="弧线上移" onClick={() => setS((cur) => moveArc(cur, ai, -1))} style={smallBtnStyle}>↑</button>
                  <button aria-label="弧线下移" onClick={() => setS((cur) => moveArc(cur, ai, 1))} style={smallBtnStyle}>↓</button>
                  <button aria-label="删除弧线" onClick={() => setS((cur) => removeArc(cur, ai))} style={smallBtnStyle}>删</button>
                </div>
              </div>
            )}

            {!readonly && (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ink-2)' }}>
                弧线的改动可能需要同步调整其下剧情点。
              </p>
            )}

            {(['conflict', 'development', 'resolution'] as const).map((field) => {
              const labels = { conflict: '核心冲突', development: '冲突发展', resolution: '矛盾解决(收束后的局势)' }
              return (
                <div key={field} style={{ marginBottom: 8 }}>
                  {label(labels[field])}
                  {readonly ? (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{arc[field]}</p>
                  ) : (
                    <textarea
                      aria-label={`弧线 ${ai + 1} ${labels[field]}`}
                      rows={2}
                      value={arc[field]}
                      onChange={(e) => setS((cur) => editArc(cur, ai, { [field]: e.target.value }))}
                      style={fieldStyle}
                    />
                  )}
                </div>
              )
            })}

            {/* 剧情点行内列表 */}
            <div style={{ marginTop: 12 }}>
              {label('剧情点(章纲切片的单位,有序)')}
              {arc.segments.map((seg, si) => (
                <div
                  key={seg.segmentId ?? `new-seg-${si}`}
                  className="outline-segment"
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius)',
                    padding: 8,
                    marginBottom: 8,
                  }}
                >
                  {readonly ? (
                    <>
                      <strong>{si + 1}. {seg.title}</strong>
                      <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{seg.summary}</p>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>落点:{seg.outcome}</p>
                    </>
                  ) : (
                    <>
                      <div className="editor-title-row">
                        <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{si + 1}.</span>
                        <input
                          aria-label={`弧线 ${ai + 1} 剧情点 ${si + 1} 标题`}
                          value={seg.title}
                          placeholder="剧情点名"
                          onChange={(e) => setS((cur) => editSegment(cur, ai, si, { title: e.target.value }))}
                          style={{ ...fieldStyle, fontWeight: 600 }}
                        />
                        <div className="editor-tools">
                          <button aria-label="剧情点上移" onClick={() => setS((cur) => moveSegment(cur, ai, si, -1))} style={smallBtnStyle}>↑</button>
                          <button aria-label="剧情点下移" onClick={() => setS((cur) => moveSegment(cur, ai, si, 1))} style={smallBtnStyle}>↓</button>
                          <button aria-label="删除剧情点" onClick={() => setS((cur) => removeSegment(cur, ai, si))} style={smallBtnStyle}>删</button>
                        </div>
                      </div>
                      <textarea
                        aria-label={`弧线 ${ai + 1} 剧情点 ${si + 1} 内容`}
                        rows={2}
                        value={seg.summary}
                        placeholder="这一段发生什么"
                        onChange={(e) => setS((cur) => editSegment(cur, ai, si, { summary: e.target.value }))}
                        style={{ ...fieldStyle, marginBottom: 4 }}
                      />
                      <input
                        aria-label={`弧线 ${ai + 1} 剧情点 ${si + 1} 落点`}
                        value={seg.outcome}
                        placeholder="落点:本段结束时局势变成什么样"
                        onChange={(e) => setS((cur) => editSegment(cur, ai, si, { outcome: e.target.value }))}
                        style={fieldStyle}
                      />
                    </>
                  )}
                </div>
              ))}
              {!readonly && (
                <button onClick={() => setS((cur) => addSegment(cur, ai))} style={btnSecondary}>
                  + 加一段
                </button>
              )}
            </div>
          </section>
        )
      })}

      {!readonly && (
        <button onClick={() => setS((cur) => addArc(cur))} style={{ ...btnSecondary, marginBottom: 16 }}>
          + 加一条弧线
        </button>
      )}

      </fieldset>
      {(unconfirmed || s.conflict || externalReadonlyDraft) && <section className="setting-recovery" aria-label="操作结果核对">
        <button type="button" style={btnSecondary} disabled={checking} onClick={() => void readCurrent()}>核对服务器内容</button>
        {remote && <><p role="status">服务器当前版本 v{remote.version}，这是当前状态观察，不是原操作回执。</p>
          <details><summary>查看服务器材料</summary>{outlineContentSchema.parse(remote.content).arcs.map((item, index) => <div key={index}><h3>{item.title}</h3><p>{item.conflict}</p></div>)}</details>
          <button type="button" style={btnSecondary} onClick={() => setLoadCandidate(remote)}>载入服务器内容</button></>}
      </section>}
      {loadCandidate && <ConfirmDialog title="载入服务器内容？" description="载入会放弃本页编辑，采用服务器当前版本。已经发出的操作可能继续处理，此操作不会撤销它。" cancelLabel="继续编辑" confirmLabel="放弃本页并载入" onCancel={() => setLoadCandidate(null)} onConfirm={() => {
        operationSequence.current++; commandBusy.current = false; frozenOperation.current = null
        setS(initReview(outlineContentSchema.parse(loadCandidate.content), loadCandidate.version, loadCandidate.id)); setObservedApproved(loadCandidate.humanStatus === 'approved')
        setLoadCandidate(null); setUnconfirmed(false); setRemote(null); setError(null); onChanged()
      }} />}
      {approveCandidate && (
        <ConfirmDialog
          title="通过大纲"
          description="通过这份大纲？它将作为设定与后续章节生成的依据。"
          cancelLabel="继续编辑"
          confirmLabel="确认通过大纲"
          onCancel={() => setApproveCandidate(null)}
          onConfirm={() => {
            // 先保存打开弹窗时的可见草稿，再按可见稿身份和版本通过；取消不执行任何命令。
            setApproveCandidate(null)
            void doApprove(approveCandidate)
          }}
        />
      )}
    </MaterialFrame>
  )
}
