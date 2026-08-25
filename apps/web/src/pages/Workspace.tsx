import { useEffect, useState } from 'react'
import type { PreprocessContent, WorkDetail } from '@agent4novel/contracts'
import { inputStages, preprocessContentSchema } from '@agent4novel/contracts'
import { getWork, savePreprocess } from '../api.js'

const STATUSES = ['idea', 'beat', 'prose'] as const
type Status = (typeof STATUSES)[number]

const STATUS_LABELS: Record<Status, string> = {
  idea: 'idea',
  beat: '章纲',
  prose: '正文',
}

const EMPTY: PreprocessContent = {
  inputStage: '脑洞',
  hooks: [],
  synopsis: [],
  setting: [],
  outline: [],
}

type Pair = { title: string; content: string }

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 8,
  border: active ? '1px solid #333' : '1px solid #ddd',
  background: active ? '#333' : '#fff',
  color: active ? '#fff' : '#333',
  cursor: 'pointer',
})

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  borderRadius: 8,
  border: '1px solid #ddd',
  fontSize: 14,
  boxSizing: 'border-box',
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
}

// 字符串要点列表编辑（卖点 / 梗概）：增、删、改
function StringListEditor({
  label,
  items,
  onChange,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  return (
    <section style={{ marginBottom: 16 }}>
      <strong>{label}</strong>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
          <textarea
            rows={2}
            value={item}
            onChange={(e) => onChange(items.map((it, j) => (j === i ? e.target.value : it)))}
            style={fieldStyle}
          />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} style={smallBtnStyle}>
            删除
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} style={{ ...smallBtnStyle, marginTop: 8 }}>
        ＋添加
      </button>
    </section>
  )
}

// 标题+内容要点列表编辑（设定 / 大纲 hint）：增、删、改
function PairListEditor({
  label,
  items,
  onChange,
}: {
  label: string
  items: Pair[]
  onChange: (items: Pair[]) => void
}) {
  return (
    <section style={{ marginBottom: 16 }}>
      <strong>{label}</strong>
      {items.map((item, i) => (
        <div
          key={i}
          style={{ marginTop: 8, padding: 10, border: '1px solid #eee', borderRadius: 8 }}
        >
          <input
            value={item.title}
            placeholder="标题"
            onChange={(e) =>
              onChange(items.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)))
            }
            style={{ ...fieldStyle, marginBottom: 6 }}
          />
          <textarea
            rows={3}
            value={item.content}
            placeholder="内容"
            onChange={(e) =>
              onChange(items.map((it, j) => (j === i ? { ...it, content: e.target.value } : it)))
            }
            style={fieldStyle}
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{ ...smallBtnStyle, marginTop: 6 }}
          >
            删除
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, { title: '', content: '' }])}
        style={{ ...smallBtnStyle, marginTop: 8 }}
      >
        ＋添加
      </button>
    </section>
  )
}

export default function Workspace({ workId, onBack }: { workId: string; onBack: () => void }) {
  const [status, setStatus] = useState<Status>('idea')
  const [work, setWork] = useState<WorkDetail | null>(null)
  const [form, setForm] = useState<PreprocessContent>(EMPTY)
  const [version, setVersion] = useState<number | null>(null)
  const [humanStatus, setHumanStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    getWork(workId)
      .then((w) => {
        setWork(w)
        const pp = w.artifacts.find((a) => a.kind === 'preprocess')
        if (pp) {
          const parsed = preprocessContentSchema.safeParse(pp.content)
          if (parsed.success) setForm(parsed.data)
          setVersion(pp.version)
          setHumanStatus(pp.humanStatus)
        }
      })
      .catch((e) => setError(String(e)))
  }, [workId])

  const save = async () => {
    setError(null)
    setNotice(null)
    try {
      const artifact = await savePreprocess(workId, form)
      setVersion(artifact.version)
      setHumanStatus(artifact.humanStatus)
      setNotice(`已保存（版本 ${artifact.version}）`)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 760 }}>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={tabStyle(status === s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {status !== 'idea' ? (
        <p style={{ color: '#999' }}>「{STATUS_LABELS[status]}」状态将在后续版本实现</p>
      ) : (
        <>
          {work && (
            <section
              style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}
            >
              <strong style={{ color: '#666' }}>脑洞（seed）</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{work.seed}</p>
            </section>
          )}
          <section style={{ marginBottom: 16 }}>
            <strong>输入阶段（inputStage）</strong>
            <select
              value={form.inputStage}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  inputStage: e.target.value as PreprocessContent['inputStage'],
                }))
              }
              style={{ ...fieldStyle, marginTop: 8, width: 'auto', display: 'block' }}
            >
              {inputStages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </section>
          <StringListEditor
            label="卖点"
            items={form.hooks}
            onChange={(hooks) => setForm((p) => ({ ...p, hooks }))}
          />
          <StringListEditor
            label="梗概"
            items={form.synopsis}
            onChange={(synopsis) => setForm((p) => ({ ...p, synopsis }))}
          />
          <PairListEditor
            label="设定"
            items={form.setting}
            onChange={(setting) => setForm((p) => ({ ...p, setting }))}
          />
          <PairListEditor
            label="大纲"
            items={form.outline}
            onChange={(outline) => setForm((p) => ({ ...p, outline }))}
          />
          <button onClick={save} style={{ padding: '10px 24px', fontSize: 15 }}>
            保存
          </button>
          {version !== null && (
            <span style={{ marginLeft: 12, color: '#666' }}>
              当前版本：{version}
              {humanStatus !== null && `（${humanStatus === 'pending' ? '待确认' : '已通过'}）`}
            </span>
          )}
          {notice && <span style={{ marginLeft: 12, color: '#2a7' }}>{notice}</span>}
        </>
      )}
    </main>
  )
}
