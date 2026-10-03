import { useState } from 'react'
import { outlineContentSchema } from '@agent4novel/contracts'
import type { CreativePack, OutlineContent } from '@agent4novel/contracts'
import { approveArtifact, saveOutlineDraft } from '../api.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
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
// 所有编辑走 outline-review 纯命令;保存 = 草稿 pending;「通过」= 通用 approve。
export default function OutlineReview(props: {
  workId: string
  content: OutlineContent
  headVersion: number
  /** 选定的方向包(顶部摘要,只读) */
  pack: CreativePack | null
  /** outline-approved 态:只读展示 */
  readonly: boolean
  onChanged: () => void
  onApproved?: () => void
}) {
  const { workId, pack, readonly, onChanged } = props
  const [s, setS] = useState<ReviewState>(() => initReview(props.content, props.headVersion))
  const [error, setError] = useState<string | null>(null)
  const [packOpen, setPackOpen] = useState(false)
  const [approveCandidate, setApproveCandidate] = useState<ReviewState | null>(null)

  // 保存草稿;返回保存后的新状态(供「通过前保存」链路复用),失败返回 null。
  // 保存期间 busy 会挡住编辑,故响应回来时本地状态一定还是 next,可直接推导。
  const doSave = async (state: ReviewState): Promise<ReviewState | null> => {
    const next = beginSave(state)
    if (next === state) return state
    setS(next)
    try {
      const a = await saveOutlineDraft(workId, savePayload(next), next.headVersion)
      const content = outlineContentSchema.parse(a.content)
      const saved = saveSucceeded(next, content, a.version)
      setS(saved)
      return saved
    } catch (err) {
      const code = (err as { code?: string })?.code
      setS((cur) => commandFailed(cur, code))
      setError('保存失败,你的编辑还在原处,可重试。')
      return null
    }
  }

  const doApprove = async (candidate: ReviewState) => {
    if (readonly || s.saving || s.approving) return
    setError(null)
    try {
      // 有脏编辑先保存(让通过落在最新内容上),再 approve
      let cur = candidate
      if (isDirty(cur)) {
        const saved = await doSave(cur)
        if (!saved) return // doSave 已负责错误提示与状态复位
        cur = saved
      }
      const next = beginApprove(cur)
      if (next === cur) return
      setS(next)
      await approveArtifact(workId, 'outline')
      setS((c) => approveSucceeded(c))
      if (props.onApproved) props.onApproved()
      else onChanged()
    } catch (err) {
      const code = (err as { code?: string })?.code
      setS((c) => commandFailed(c, code))
      setError('通过失败,你的编辑还在原处,可重试。')
    }
  }

  const label = (text: string) => (
    <div className="field-label">{text}</div>
  )

  return (
    <div className="outline-review">
      <header className="page-heading">
        <div>
          <p className="eyebrow">全书大纲</p>
          <h2>梳理故事的走向</h2>
          <p className="page-lede">以弧线组织冲突，以剧情点安排变化。通过后作为设定与章纲的依据。</p>
        </div>
      </header>
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
      {s.notice && <p className="status-message" role="status">{s.notice}</p>}

      {/* 弧线时间线 */}
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

      {!readonly && (
        <footer className="review-actions">
          <span className="review-save-state" role="status">
            {s.saving ? '保存中……' : isDirty(s) ? '有未保存的修改' : '通过前可编辑大纲'}
          </span>
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
        </footer>
      )}
      {approveCandidate && (
        <ConfirmDialog
          title="通过大纲"
          description="通过这份大纲？它将作为设定与后续章节生成的依据。"
          cancelLabel="继续编辑"
          confirmLabel="确认通过大纲"
          onCancel={() => setApproveCandidate(null)}
          onConfirm={() => {
            // 先保存打开弹窗时的可见草稿，再沿用原审批接口；取消不执行任何命令。
            setApproveCandidate(null)
            void doApprove(approveCandidate)
          }}
        />
      )}
    </div>
  )
}
