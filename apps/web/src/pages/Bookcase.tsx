import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkSummary } from '@agent4novel/contracts'
import { listWorks } from '../api.js'
import { btnPrimary, btnSecondary } from '../ui.js'

export default function Bookcase({
  onNew,
  onOpen,
}: {
  onNew: () => void
  onOpen: (workId: string) => void
}) {
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const active = useRef(false)
  const readSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++readSequence.current
    setPhase('loading'); setError(null)
    try {
      const result = await listWorks()
      if (!active.current || sequence !== readSequence.current) return
      setWorks(result); setPhase('ready')
    } catch {
      if (!active.current || sequence !== readSequence.current) return
      setError('作品暂时无法读取，请稍后重试。'); setPhase('failed')
    }
  }, [])
  useEffect(() => {
    active.current = true; void load()
    return () => { active.current = false; readSequence.current++ }
  }, [load])

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
      {phase === 'loading' && <p role="status" className="setting-muted">正在读取作品…</p>}
      {error && <div><p role="alert" className="status-message status-error">{error}</p><button type="button" style={btnSecondary} onClick={() => void load()}>重新读取书架</button></div>}
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
      {phase === 'ready' && works.length === 0 && (
        <section className="empty-state surface">
          <h2>暂无作品</h2>
          <p className="page-lede">一段脑洞、一份设定或一条故事主线，都可以成为起点。</p>
        </section>
      )}
    </main>
  )
}
