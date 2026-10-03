import { useEffect, useState } from 'react'
import type { WorkSummary } from '@agent4novel/contracts'
import { listWorks } from '../api.js'
import { btnPrimary } from '../ui.js'

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
    <main className="bookcase-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">作品库</p>
          <h1>书架</h1>
          <p className="page-lede">打开作品继续写作，或从一个新的故事开始。</p>
        </div>
        <button onClick={onNew} style={btnPrimary}>
          ＋ 开始创作
        </button>
      </header>
      {error && <p role="alert" className="status-message status-error">{error}</p>}
      <div className="bookcase-grid">
        {works.map((w, i) => (
          <button
            key={w.id}
            onClick={() => onOpen(w.id)}
            className="bookcase-card surface"
          >
            <span className="bookcase-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <strong className="bookcase-title">{w.title}</strong>
            <span className="bookcase-preview">{w.seedPreview}</span>
            <small className="bookcase-meta">
              <span>已完成 {w.chapterCount} 章</span>
              <span aria-hidden="true">打开 →</span>
            </small>
          </button>
        ))}
      </div>
      {works.length === 0 && !error && (
        <section className="empty-state surface">
          <h2>暂无作品</h2>
          <p className="page-lede">一段脑洞、一份设定或一条故事主线，都可以成为起点。</p>
        </section>
      )}
    </main>
  )
}
