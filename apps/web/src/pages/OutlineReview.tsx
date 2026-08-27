import { useState } from 'react'
import { outlineContentSchema } from '@agent4novel/contracts'
import type { CreativePack, OutlineContent } from '@agent4novel/contracts'
import { approveArtifact, saveOutlineDraft } from '../api.js'
import { btnPrimary, btnSecondary, cardStyle, fieldStyle, smallBtnStyle } from '../ui.js'
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

// 弧线强调色轮转(决策 16:珊瑚→紫→青→琥珀→粉)
const ARC_COLORS = ['accent', 'violet', 'teal', 'amber', 'pink'] as const

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
}) {
  const { workId, pack, readonly, onChanged } = props
  const [s, setS] = useState<ReviewState>(() => initReview(props.content, props.headVersion))
  const [error, setError] = useState<string | null>(null)
  const [packOpen, setPackOpen] = useState(false)

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

  const doApprove = async () => {
    if (!window.confirm('通过这份大纲?通过后全书结构锁定,后续按它生成章纲。')) return
    setError(null)
    try {
      // 有脏编辑先保存(让通过落在最新内容上),再 approve
      let cur = s
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
      onChanged()
    } catch (err) {
      const code = (err as { code?: string })?.code
      setS((c) => commandFailed(c, code))
      setError('通过失败,你的编辑还在原处,可重试。')
    }
  }

  const label = (text: string) => (
    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>{text}</div>
  )

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* 顶部:选定方向摘要窄条(可折叠) */}
      {pack && (
        <section style={{ ...cardStyle, marginBottom: 16, background: 'var(--bg-sunken)' }}>
          <button
            onClick={() => setPackOpen((v) => !v)}
            aria-expanded={packOpen}
            style={{ ...smallBtnStyle, border: 'none', background: 'none', padding: 0 }}
          >
            {packOpen ? '▾' : '▸'} 选定方向:{pack.title}
          </button>
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
        <p style={{ color: 'var(--warn-ink)', background: 'var(--warn-bg)', padding: 8, borderRadius: 'var(--radius)' }}>
          内容已在别处更新(409),你的编辑保留在原处;刷新后可基于最新版继续。
        </p>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {s.notice && <p style={{ color: 'var(--ok)' }}>{s.notice}</p>}

      {/* 弧线时间线 */}
      {s.draft.arcs.map((arc, ai) => {
        const accent = ARC_COLORS[ai % ARC_COLORS.length]!
        return (
          <section
            key={arc.arcId ?? `new-arc-${ai}`}
            style={{ ...cardStyle, borderTop: `3px solid var(--${accent})`, marginBottom: 16 }}
          >
            {readonly ? (
              <h2 style={{ margin: '0 0 8px' }}>{arc.title}</h2>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  value={arc.title}
                  placeholder="弧线名(如:退婚之辱)"
                  onChange={(e) => setS((cur) => editArc(cur, ai, { title: e.target.value }))}
                  style={{ ...fieldStyle, fontSize: 18, fontWeight: 600 }}
                />
                <button aria-label="弧线上移" onClick={() => setS((cur) => moveArc(cur, ai, -1))} style={smallBtnStyle}>↑</button>
                <button aria-label="弧线下移" onClick={() => setS((cur) => moveArc(cur, ai, 1))} style={smallBtnStyle}>↓</button>
                <button aria-label="删除弧线" onClick={() => setS((cur) => removeArc(cur, ai))} style={smallBtnStyle}>删</button>
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
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{si + 1}.</span>
                        <input
                          value={seg.title}
                          placeholder="剧情点名"
                          onChange={(e) => setS((cur) => editSegment(cur, ai, si, { title: e.target.value }))}
                          style={{ ...fieldStyle, fontWeight: 600 }}
                        />
                        <button aria-label="剧情点上移" onClick={() => setS((cur) => moveSegment(cur, ai, si, -1))} style={smallBtnStyle}>↑</button>
                        <button aria-label="剧情点下移" onClick={() => setS((cur) => moveSegment(cur, ai, si, 1))} style={smallBtnStyle}>↓</button>
                        <button aria-label="删除剧情点" onClick={() => setS((cur) => removeSegment(cur, ai, si))} style={smallBtnStyle}>删</button>
                      </div>
                      <textarea
                        rows={2}
                        value={seg.summary}
                        placeholder="这一段发生什么"
                        onChange={(e) => setS((cur) => editSegment(cur, ai, si, { summary: e.target.value }))}
                        style={{ ...fieldStyle, marginBottom: 4 }}
                      />
                      <input
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

      {/* 保存 pill(脏时浮现) */}
      {!readonly && isDirty(s) && (
        <button
          onClick={() => void doSave(s)}
          disabled={s.saving || s.approving}
          style={{
            ...btnSecondary,
            position: 'fixed',
            right: 24,
            bottom: 72,
            borderRadius: 999,
            background: 'var(--ink)',
            color: 'var(--bg)',
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          {s.saving ? '保存中……' : '保存草稿'}
        </button>
      )}

      {/* 底部通过细条 */}
      {!readonly && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '12px 24px',
            background: 'var(--bg-raised)',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <button
            onClick={() => void doApprove()}
            disabled={s.saving || s.approving}
            style={{ ...btnPrimary, minWidth: 240 }}
          >
            {s.approving ? '通过中……' : '通过大纲 →'}
          </button>
        </div>
      )}
    </div>
  )
}
