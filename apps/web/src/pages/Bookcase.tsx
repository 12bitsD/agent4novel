import { useEffect, useState } from 'react'
import type { WorkSummary } from '@agent4novel/contracts'
import { listWorks } from '../api.js'
import { btnPrimary, cardStyle } from '../ui.js'

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
    <main style={{ padding: 24, maxWidth: 960 }}>
      <h1>书架</h1>
      <button onClick={onNew} style={{ ...btnPrimary, marginBottom: 16 }}>
        ＋ 开始创作
      </button>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {works.map((w) => (
          <button
            key={w.id}
            onClick={() => onOpen(w.id)}
            style={{
              ...cardStyle,
              width: 220,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 8 }}>{w.title}</strong>
            <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{w.seedPreview}</span>
            <small style={{ display: 'block', marginTop: 8, color: 'var(--ink-3)' }}>
              {w.chapterCount} 章
            </small>
          </button>
        ))}
      </div>
      {works.length === 0 && !error && <p style={{ color: 'var(--ink-2)' }}>暂无作品</p>}
    </main>
  )
}
