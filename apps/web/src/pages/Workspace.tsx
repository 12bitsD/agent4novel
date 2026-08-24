import { useEffect, useState } from 'react'
import type { PreprocessContent, WorkDetail } from '@agent4novel/contracts'
import { getWork, savePreprocess } from '../api.js'

const STATUSES = ['idea', 'beat', 'prose'] as const
type Status = (typeof STATUSES)[number]

const FIELDS: Array<{ key: keyof PreprocessContent; label: string; rows: number }> = [
  { key: 'hook', label: '卖点', rows: 2 },
  { key: 'synopsis', label: '梗概', rows: 6 },
  { key: 'setting', label: '设定', rows: 4 },
  { key: 'outline', label: '大纲（场景）', rows: 6 },
]

const EMPTY: PreprocessContent = { hook: '', synopsis: '', setting: '', outline: '' }

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 8,
  border: active ? '1px solid #333' : '1px solid #ddd',
  background: active ? '#333' : '#fff',
  color: active ? '#fff' : '#333',
  cursor: 'pointer',
})

export default function Workspace({ workId, onBack }: { workId: string; onBack: () => void }) {
  const [status, setStatus] = useState<Status>('idea')
  const [work, setWork] = useState<WorkDetail | null>(null)
  const [form, setForm] = useState<PreprocessContent>(EMPTY)
  const [version, setVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    getWork(workId)
      .then((w) => {
        setWork(w)
        const pp = w.artifacts.find((a) => a.kind === 'preprocess')
        if (pp) {
          setForm(pp.content as PreprocessContent)
          setVersion(pp.version)
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
      setNotice(`已保存（版本 ${artifact.version}）`)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 760 }}>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={tabStyle(status === s)}>
            {s}
          </button>
        ))}
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {status !== 'idea' ? (
        <p style={{ color: '#999' }}>「{status}」状态将在后续版本实现</p>
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
          {FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'block', marginBottom: 14 }}>
              <strong>{f.label}</strong>
              <textarea
                rows={f.rows}
                value={form[f.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 10,
                  marginTop: 6,
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          ))}
          <button onClick={save} style={{ padding: '10px 24px', fontSize: 15 }}>
            保存
          </button>
          {version !== null && (
            <span style={{ marginLeft: 12, color: '#666' }}>当前版本：{version}</span>
          )}
          {notice && <span style={{ marginLeft: 12, color: '#2a7' }}>{notice}</span>}
        </>
      )}
    </main>
  )
}
