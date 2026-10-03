import { useState } from 'react'
import type { CaptionContent, CreativeContent } from '@agent4novel/contracts'
import { saveCreativeDraft, selectCreativeDirection } from '../api.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
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
  readonly,
  onChanged,
  onSelected,
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
}) {
  const [s, setS] = useState<CompareState>(() => initCompare(content, headVersion))
  const [captionOpen, setCaptionOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectCandidate, setSelectCandidate] = useState<CompareState | null>(null)

  const pack = activePack(s)

  const doSave = async () => {
    const next = beginSave(s)
    if (next === s) return
    setS(next)
    setError(null)
    try {
      const a = await saveCreativeDraft(workId, savePayload(next), next.headVersion)
      setS((cur) => saveSucceeded(cur, a.version))
    } catch (err) {
      const code = (err as { code?: string })?.code
      setS((cur) => commandFailed(cur, code ?? String(err)))
      setError('保存失败,你的编辑还在原处,可重试。')
    }
  }

  const doSelect = async (candidate: CompareState) => {
    if (readonly || s.saving || s.selecting) return
    const next = beginSelect(candidate)
    if (next === candidate) return
    setS(next)
    setError(null)
    try {
      // 有未保存编辑时,先落草稿(全部方向,pending)再选定,保证选定的是最新编辑
      let head = next.headVersion
      if (isDirty(next)) {
        const a = await saveCreativeDraft(workId, savePayload(next), head)
        head = a.version
      }
      await selectCreativeDirection(workId, next.activeId, head)
      setS((cur) => selectSucceeded(cur))
      // #4 决策 10:选定后自动续跑 advance(由 Workspace 触发);无钩子则只刷新
      if (onSelected) onSelected()
      else onChanged()
    } catch (err) {
      const code = (err as { code?: string })?.code
      setS((cur) => commandFailed(cur, code ?? String(err)))
      setError('选定失败,你的编辑还在原处,可重试。')
    }
  }

  return (
    <div className="creative-review">
      <header className="page-heading">
        <div>
          <p className="eyebrow">创作方向</p>
          <h2>找到故事的起点</h2>
          <p className="page-lede">比较各个方向，调整内容，再选定要继续写的故事。</p>
        </div>
      </header>
      {/* 2026-10-03：B+C 视觉对齐；方向选择保留普通按钮语义，不模拟缺少键盘协议的 tabs。 */}
      <div role="group" aria-label="创作方向" className="choice-row">
        {s.packs.map((p) => {
          const active = p.directionId === s.activeId
          return (
            <button
              key={p.directionId}
              aria-pressed={active}
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
      {s.notice && <p role="status" className="status-message">{s.notice}</p>}

      {/* 海报主体 */}
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

      {!readonly && (
        <footer className="review-actions">
          <span className="review-save-state" role="status">
            {s.saving ? '保存中……' : isDirty(s) ? '有未保存的修改' : '编辑当前方向后可保存'}
          </span>
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
        </footer>
      )}
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
    </div>
  )
}
