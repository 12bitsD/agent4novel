import { useCallback, useEffect, useRef, useState } from 'react'
import { captionContentSchema, creativeContentSchema, outlineContentSchema, settingArtifactSchema } from '@agent4novel/contracts'
import type { CaptionContent, CreativeContent, OutlineContent, WorkView } from '@agent4novel/contracts'
import { advance, getWork } from '../api.js'
import { btnPrimary, btnSecondary, cardStyle } from '../ui.js'
import CreativePoster from './CreativePoster.js'
import OutlineReview from './OutlineReview.js'
import SettingReview from './SettingReview.js'
import { initSettingReview, isSettingDirty, reduceSettingReview, type SettingReviewAction, type SettingReviewState } from '../setting-review.js'
import { confirmSettingApproval, finishSettingApproval } from '../setting-api.js'
import { ConfirmDialog } from '../ConfirmDialog.js'

// Workspace 只渲染 server 读模型(workflowState/allowedActions 来自 GET /works/:id 同快照),
// 不在前端重建状态机。生成/重试 = 同一个 advance(幂等,从失败步骤恢复)。
export default function Workspace({ workId, onBack }: { workId: string; onBack: () => void }) {
  const [work, setWork] = useState<WorkView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState<string | null>(null)
  const [setting, setSettingState] = useState<SettingReviewState | null>(null)
  const [leaving, setLeaving] = useState(false)
  const settingRef = useRef<SettingReviewState | null>(null)
  const workRef = useRef<WorkView | null>(null)
  const mounted = useRef(false)
  const readSequence = useRef(0)
  const commandSequence = useRef(0)
  const generationBusy = useRef(false)
  const setSetting = useCallback((next: SettingReviewState) => {
    settingRef.current = next
    setSettingState(next)
  }, [])
  const acceptWork = useCallback((view: WorkView, observe = true) => {
    workRef.current = view
    setWork(view)
    const current = settingRef.current
    const candidate = settingArtifactSchema.safeParse(view.artifacts.find((artifact) => artifact.kind === 'setting')).data
    if (!current && candidate?.workId === view.id) setSetting(initSettingReview(candidate))
    else if (current && observe) setSetting(reduceSettingReview(current, { type: 'observe-work', work: view }))
  }, [setSetting])

  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current
    try {
      const view = await getWork(workId)
      if (!mounted.current || sequence !== readSequence.current || view.id !== workId) return null
      acceptWork(view)
      return view
    } catch {
      if (mounted.current && sequence === readSequence.current) setError('读取作品失败，请重试。')
      return null
    }
  }, [workId, acceptWork])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; readSequence.current++; commandSequence.current++ }
  }, [refresh])
  const dirty = setting !== null && isSettingDirty(setting)
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const generate = useCallback(async (stepId = workRef.current?.nextStepId ?? null) => {
    if (generationBusy.current) return
    generationBusy.current = true
    setGenerationStep(stepId)
    setError(null)
    setGenerating(true)
    try {
      const outcome = await advance(workId)
      if (!mounted.current) return
      if (outcome.kind === 'failed') {
        setError(`生成失败(${outcome.code})${outcome.retryable ? ',可重试' : ''}`)
      }
      await refresh()
    } catch {
      if (mounted.current) setError('生成请求未完成，请刷新作品确认当前进度。')
    } finally {
      generationBusy.current = false
      if (mounted.current) setGenerating(false)
    }
  }, [workId, refresh])
  const continueAfterApproval = useCallback(async () => {
    const view = await refresh()
    if (view?.allowedActions.includes('generate')) await generate(view.nextStepId)
  }, [refresh, generate])
  const settingAction = (action: SettingReviewAction) => {
    if (settingRef.current) setSetting(reduceSettingReview(settingRef.current, action))
  }
  const runSetting = async (mode: 'submit' | 'retry' | 'confirm') => {
    const current = settingRef.current
    if (!current || current.phase === 'submitting' || current.phase === 'reconciling') return
    if (mode === 'submit' && (workRef.current?.workflowState !== 'awaiting-setting-review' || !workRef.current.allowedActions.includes('approve'))) return
    const next = reduceSettingReview(current, { type: mode === 'confirm' ? 'reconcile' : mode })
    setSetting(next)
    if (mode !== 'confirm' && next.phase !== 'submitting') return
    const sequence = ++commandSequence.current
    readSequence.current++
    const result = await (mode === 'confirm' ? confirmSettingApproval(next) : finishSettingApproval(next))
    if (!mounted.current || sequence !== commandSequence.current) return
    readSequence.current++
    setSetting(result.state)
    if (result.work) acceptWork(result.work, false)
    else if (result.state.phase === 'approved') await refresh()
  }

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

  const state = generating ? 'generating' : (work?.workflowState ?? 'ready-to-generate')
  const showPoster =
    work?.workflowState === 'awaiting-selection' &&
    creative !== null &&
    creativeArtifact !== undefined
  const showOutline =
    (work?.workflowState === 'awaiting-outline-review' || work?.workflowState === 'outline-approved') &&
    outline !== null &&
    outlineArtifact !== undefined

  const showSetting = setting !== null && (work?.workflowState === 'awaiting-setting-review' || work?.workflowState === 'setting-approved')
  const nextStep = generating ? generationStep : work?.nextStepId
  const stepLabel = nextStep === 'setting' ? '设定' : nextStep === 'outline' ? '大纲' : '创意稿'

  return (
    <main style={{ padding: 24, maxWidth: 860 }}>
      <button
        onClick={() => { if (settingRef.current && isSettingDirty(settingRef.current)) setLeaving(true); else onBack() }}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {error && <button type="button" style={btnSecondary} onClick={() => void refresh()}>刷新作品</button>}

      {work && !showPoster && !showOutline && !showSetting && (
        <section style={{ ...cardStyle, marginBottom: 16, background: 'var(--bg-sunken)' }}>
          <strong style={{ color: 'var(--ink-2)' }}>脑洞（seed）</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{work.seed}</p>
        </section>
      )}

      {(state === 'ready-to-generate' || state === 'failed') && work?.allowedActions.includes('generate') && (
        <button onClick={() => void generate()} disabled={generating} style={btnPrimary}>
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
          onChanged={() => void refresh()}
          onSelected={() => void continueAfterApproval()}
        />
      )}

      {showOutline && outlineArtifact && (
        <OutlineReview
          workId={workId}
          content={outline as OutlineContent}
          headVersion={outlineArtifact.version}
          pack={creative?.directions[0] ?? null}
          readonly={work!.workflowState === 'outline-approved'}
          onChanged={() => void refresh()}
          onApproved={() => void continueAfterApproval()}
        />
      )}
      {showSetting && setting && <SettingReview state={setting} onAction={settingAction}
        allowApprove={work?.workflowState === 'awaiting-setting-review' && work.allowedActions.includes('approve')}
        onApprove={() => void runSetting('submit')} onConfirm={() => void runSetting('confirm')} onRetry={() => void runSetting('retry')} />}
      {setting && !showSetting && setting.phase !== 'approved' && <p className="setting-notice">设定的本页修改仍保留。完成前置关卡后可继续查看。</p>}
      {leaving && <ConfirmDialog title="尚未通过设定" description="当前修改只保存在本页，离开后将无法恢复。"
        cancelLabel="继续编辑" confirmLabel="放弃修改并离开" onCancel={() => setLeaving(false)} onConfirm={() => {
          commandSequence.current++
          readSequence.current++
          setLeaving(false)
          onBack()
        }} />}
    </main>
  )
}
