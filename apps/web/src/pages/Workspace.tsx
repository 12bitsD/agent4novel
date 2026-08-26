import { useCallback, useEffect, useState } from 'react'
import type { WorkView } from '@agent4novel/contracts'
import { advance, getWork } from '../api.js'
import { btnPrimary, btnSecondary, cardStyle } from '../ui.js'

// 切片 2 的最小 Workspace:只渲染 server 读模型 + 触发生成;创意海报在切片 3 落地。
// 状态机不在此重建——workflowState/allowedActions 全部来自 GET /works/:id 同快照。
export default function Workspace({ workId, onBack }: { workId: string; onBack: () => void }) {
  const [work, setWork] = useState<WorkView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const refresh = useCallback(() => {
    getWork(workId)
      .then(setWork)
      .catch((e) => setError(String(e)))
  }, [workId])

  useEffect(refresh, [refresh])

  const generate = async () => {
    setError(null)
    setGenerating(true)
    try {
      await advance(workId)
      refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setGenerating(false)
    }
  }

  const state = generating ? 'generating' : (work?.workflowState ?? 'ready-to-generate')

  return (
    <main style={{ padding: 24, maxWidth: 760 }}>
      <button
        onClick={onBack}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {work && (
        <section style={{ ...cardStyle, marginBottom: 16, background: 'var(--bg-sunken)' }}>
          <strong style={{ color: 'var(--ink-2)' }}>脑洞（seed）</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{work.seed}</p>
        </section>
      )}

      {(state === 'ready-to-generate' || state === 'failed') && (
        <button onClick={generate} disabled={generating} style={btnPrimary}>
          生成创意稿
        </button>
      )}
      {state === 'generating' && <p style={{ color: 'var(--ink-2)' }}>正在提炼素材并生成创意稿……</p>}

      {work?.artifacts.map((a) => (
        <section key={a.id} style={{ ...cardStyle, marginTop: 16 }}>
          <strong>
            {a.kind}（版本 {a.version},{a.humanStatus === 'pending' ? '待把关' : '已通过'}）
          </strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--ink-2)' }}>
            {JSON.stringify(a.content, null, 2)}
          </pre>
        </section>
      ))}
    </main>
  )
}
