import { useState } from 'react'
import type { CaptionContent, CreativeContent, CreativePack } from '@agent4novel/contracts'
import { saveCreativeDraft, selectCreativeDirection } from '../api.js'
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
import { btnPrimary, btnSecondary, cardStyle, chipStyle, fieldStyle } from '../ui.js'

// 方向 tab 的多巴胺强调色轮转(A=珊瑚 / B=紫 / C=青)
const TAB_COLORS = ['accent', 'violet', 'teal'] as const

// —— 小编辑器(全走本地缓存,不直达 server)——

function StringChipsEditor({
  items,
  onChange,
  readonly,
}: {
  items: string[]
  onChange: (items: string[]) => void
  readonly: boolean
}) {
  if (readonly) {
    return (
      <span>
        {items.map((t, i) => (
          <span key={i} style={{ ...chipStyle(TAB_COLORS[i % 3]!), marginRight: 6 }}>{t}</span>
        ))}
      </span>
    )
  }
  return (
    <span>
      {items.map((t, i) => (
        <input
          key={i}
          value={t}
          onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          style={{ ...fieldStyle, width: 120, display: 'inline-block', marginRight: 6, padding: '2px 8px' }}
        />
      ))}
      <button onClick={() => onChange([...items, ''])} style={{ ...btnSecondary, padding: '2px 10px', fontSize: 13 }}>
        ＋
      </button>
    </span>
  )
}

function HintListEditor({
  items,
  onChange,
  readonly,
}: {
  items: { title: string; content: string }[]
  onChange: (items: { title: string; content: string }[]) => void
  readonly: boolean
}) {
  if (readonly) {
    return (
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {items.map((it, i) => (
          <div key={i} style={{ ...cardStyle, padding: 10, minWidth: 160, flex: '1 1 200px' }}>
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
        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
          <input
            value={it.title}
            placeholder="标题"
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
            }
            style={{ ...fieldStyle, width: 140 }}
          />
          <textarea
            rows={2}
            value={it.content}
            placeholder="内容"
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
            }
            style={fieldStyle}
          />
          <button
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

  const pack = activePack(s)
  const activeIndex = s.packs.findIndex((p) => p.directionId === s.activeId)
  const accent = TAB_COLORS[activeIndex % 3]!

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

  const doSelect = async () => {
    if (!window.confirm(`就按「${pack.title}」这个方向写?选定后其余方向留在历史版本里。`)) return
    const next = beginSelect(s)
    if (next === s) return
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
    <div style={{ paddingBottom: 96 }}>
      {/* 方向 tab:原生 button + aria */}
      <div role="tablist" aria-label="创作方向" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {s.packs.map((p, i) => {
          const active = p.directionId === s.activeId
          const c = TAB_COLORS[i % 3]!
          return (
            <button
              key={p.directionId}
              role="tab"
              aria-selected={active}
              onClick={() => setS((cur) => switchTab(cur, p.directionId))}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                cursor: 'pointer',
                border: `1px solid var(--${c})`,
                background: active ? `var(--${c})` : 'var(--bg-raised)',
                color: active ? 'var(--accent-ink)' : `var(--${c})`,
                fontSize: 14,
              }}
            >
              {s.drafts[p.directionId]?.title || p.title}
            </button>
          )
        })}
      </div>

      {s.conflict && (
        <p style={{ color: 'var(--warn-ink)', background: 'var(--warn-bg)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>
          内容已在别处更新(409),你的编辑保留在原处;刷新后可基于最新版继续。
        </p>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {s.notice && <p style={{ color: 'var(--ok)' }}>{s.notice}</p>}

      {/* 海报主体 */}
      <section style={{ ...cardStyle, borderTop: `3px solid var(--${accent})` }}>
        {readonly ? (
          <h2 style={{ marginTop: 0 }}>{pack.title}</h2>
        ) : (
          <input
            value={pack.title}
            onChange={(e) => setS((cur) => editActive(cur, { title: e.target.value }))}
            style={{ ...fieldStyle, fontSize: 22, fontWeight: 700, marginBottom: 8 }}
          />
        )}

        <p style={{ fontSize: 17, color: `var(--${accent})`, fontWeight: 600 }}>钩子</p>
        {readonly ? (
          <p style={{ fontSize: 16 }}>{pack.hook}</p>
        ) : (
          <textarea
            rows={2}
            value={pack.hook}
            onChange={(e) => setS((cur) => editActive(cur, { hook: e.target.value }))}
            style={{ ...fieldStyle, fontSize: 16 }}
          />
        )}

        <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 6 }}>题材标签</p>
        <StringChipsEditor
          items={pack.tags}
          readonly={readonly}
          onChange={(tags) => setS((cur) => editActive(cur, { tags }))}
        />

        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '16px 0 6px' }}>梗概</p>
        {readonly ? (
          <p style={{ whiteSpace: 'pre-wrap' }}>{pack.synopsis}</p>
        ) : (
          <textarea
            rows={5}
            value={pack.synopsis}
            onChange={(e) => setS((cur) => editActive(cur, { synopsis: e.target.value }))}
            style={fieldStyle}
          />
        )}

        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '16px 0 6px' }}>人物</p>
        <HintListEditor
          items={pack.characters}
          readonly={readonly}
          onChange={(characters) => setS((cur) => editActive(cur, { characters }))}
        />

        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '16px 0 6px' }}>设定</p>
        <HintListEditor
          items={pack.setting}
          readonly={readonly}
          onChange={(setting) => setS((cur) => editActive(cur, { setting }))}
        />

        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '16px 0 6px' }}>爽点</p>
        <StringChipsEditor
          items={pack.payoffs}
          readonly={readonly}
          onChange={(payoffs) => setS((cur) => editActive(cur, { payoffs }))}
        />

        <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '16px 0 6px' }}>大纲走向</p>
        <HintListEditor
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

      {/* 脏时浮动保存 pill */}
      {!readonly && isDirty(s) && (
        <button
          onClick={doSave}
          disabled={s.saving || s.selecting}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 72,
            borderRadius: 999,
            border: 'none',
            padding: '10px 22px',
            fontSize: 14,
            cursor: 'pointer',
            background: 'var(--ink)',
            color: 'var(--bg)',
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          {s.saving ? '保存中……' : '保存全部方向'}
        </button>
      )}

      {/* 底部选定细条 */}
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
            onClick={doSelect}
            disabled={s.saving || s.selecting}
            style={{ ...btnPrimary, minWidth: 240 }}
          >
            {s.selecting ? '选定中……' : `就按「${pack.title}」这个方向写 →`}
          </button>
        </div>
      )}
    </div>
  )
}
