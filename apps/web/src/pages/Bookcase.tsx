import { useEffect, useState } from 'react'
import type { WorkDetail, WorkSummary } from '@agent4novel/contracts'
import { getWork, listWorks } from '../api.js'

const KIND_LABEL: Record<string, string> = {
  hook: '卖点',
  synopsis: '梗概',
  outline: '大纲',
  setting: '设定',
  beat: '章纲',
  prose: '正文',
}

export default function Bookcase() {
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    listWorks()
      .then(setWorks)
      .catch((e) => setError(String(e)))
  }, [])

  if (selectedId) {
    return <WorkDetailStub id={selectedId} onBack={() => setSelectedId(null)} />
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>书架</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {works.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelectedId(w.id)}
            style={{
              width: 220,
              textAlign: 'left',
              padding: 16,
              borderRadius: 10,
              border: '1px solid #ddd',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 8 }}>{w.title}</strong>
            <span style={{ color: '#666', fontSize: 13 }}>{w.seedPreview}</span>
            <small style={{ display: 'block', marginTop: 8, color: '#999' }}>
              {w.chapterCount} 章
            </small>
          </button>
        ))}
      </div>
      {works.length === 0 && !error && <p>暂无作品</p>}
    </main>
  )
}

function WorkDetailStub({ id, onBack }: { id: string; onBack: () => void }) {
  const [work, setWork] = useState<WorkDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getWork(id)
      .then(setWork)
      .catch((e) => setError(String(e)))
  }, [id])

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← 返回书架
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {work && (
        <>
          <h1>{work.title}</h1>
          <p style={{ color: '#666' }}>{work.seed}</p>
          <p style={{ color: '#999' }}>详情页占位（分层管理在 #6 实现）</p>
          {work.artifacts.length === 0 ? (
            <p>暂无产物</p>
          ) : (
            <ul>
              {work.artifacts.map((a) => (
                <li key={a.id}>
                  [{KIND_LABEL[a.kind] ?? a.kind}] v{a.version} · {a.humanStatus}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
