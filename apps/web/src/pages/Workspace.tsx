import { useCallback, useEffect, useState } from 'react'
import { captionContentSchema, creativeContentSchema, outlineContentSchema } from '@agent4novel/contracts'
import type { CaptionContent, CreativeContent, OutlineContent, WorkView } from '@agent4novel/contracts'
import { advance, getWork } from '../api.js'
import { btnPrimary, btnSecondary, cardStyle } from '../ui.js'
import CreativePoster from './CreativePoster.js'
import OutlineReview from './OutlineReview.js'

// Workspace 只渲染 server 读模型(workflowState/allowedActions 来自 GET /works/:id 同快照),
// 不在前端重建状态机。生成/重试 = 同一个 advance(幂等,从失败步骤恢复)。
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

  const generate = useCallback(async () => {
    setError(null)
    setGenerating(true)
    try {
      const outcome = await advance(workId)
      if (outcome.kind === 'failed') {
        setError(`生成失败(${outcome.code})${outcome.retryable ? ',可重试' : ''}`)
      }
      refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setGenerating(false)
    }
  }, [workId, refresh])

  const creativeArtifact = work?.artifacts.find((a) => a.kind === 'creative')
  const captionArtifact = work?.artifacts.find((a) => a.kind === 'caption')
  const outlineArtifact = work?.artifacts.find((a) => a.kind === 'outline')
  const creative = creativeArtifact
    ? (creativeContentSchema.safeParse(creativeArtifact.content).data ?? null)
    : null
  const caption: CaptionContent | null = captionArtifact
    ? (captionContentSchema.safeParse(captionArtifact.content).data ?? null)
    : null
  const outline: OutlineContent | null = outlineArtifact
    ? (outlineContentSchema.safeParse(outlineArtifact.content).data ?? null)
    : null

  const creativeApproved = creativeArtifact?.humanStatus === 'approved'
  const state = generating ? 'generating' : (work?.workflowState ?? 'ready-to-generate')
  const showPoster =
    work?.workflowState === 'awaiting-selection' &&
    creative !== null &&
    creativeArtifact !== undefined
  const showOutline =
    (work?.workflowState === 'awaiting-outline-review' || work?.workflowState === 'outline-approved') &&
    outline !== null &&
    outlineArtifact !== undefined

  // 按钮/加载文案按进度切换:creative 未选定 → 创意稿;已选定 → 大纲
  const stepLabel = creativeApproved ? '大纲' : '创意稿'

  return (
    <main style={{ padding: 24, maxWidth: 860 }}>
      <button
        onClick={onBack}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {work && !showPoster && !showOutline && (
        <section style={{ ...cardStyle, marginBottom: 16, background: 'var(--bg-sunken)' }}>
          <strong style={{ color: 'var(--ink-2)' }}>脑洞（seed）</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{work.seed}</p>
        </section>
      )}

      {(state === 'ready-to-generate' || state === 'failed') && (
        <button onClick={generate} disabled={generating} style={btnPrimary}>
          {state === 'failed' ? `重试生成${stepLabel}` : `生成${stepLabel}`}
        </button>
      )}
      {state === 'generating' && (
        <p style={{ color: 'var(--ink-2)' }}>正在生成{stepLabel}……</p>
      )}

      {showPoster && creativeArtifact && (
        <CreativePoster
          workId={workId}
          content={creative as CreativeContent}
          headVersion={creativeArtifact.version}
          caption={caption}
          readonly={false}
          onChanged={refresh}
          onSelected={() => void generate()}
        />
      )}

      {showOutline && outlineArtifact && (
        <OutlineReview
          workId={workId}
          content={outline as OutlineContent}
          headVersion={outlineArtifact.version}
          pack={creative?.directions[0] ?? null}
          readonly={work!.workflowState === 'outline-approved'}
          onChanged={refresh}
        />
      )}
    </main>
  )
}
