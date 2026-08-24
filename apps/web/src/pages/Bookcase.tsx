import { useEffect, useState } from 'react'
import type { WorkSummary } from '@agent4novel/contracts'
import { listWorks } from '../api.js'

export default function Bookcase({
  onNew,
  onOpen,
}: {
  onNew: () => void
  onOpen: (workId: string) => void
}) {
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listWorks()
      .then(setWorks)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>书架</h1>
      <button onClick={onNew} style={{ marginBottom: 16, padding: '8px 16px' }}>
        ＋ 开始创作
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {works.map((w) => (
          <button
            key={w.id}
            onClick={() => onOpen(w.id)}
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
