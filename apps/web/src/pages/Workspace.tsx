import { useCallback, useEffect, useRef, useState } from 'react'
import { captionContentSchema, creativeContentSchema, outlineContentSchema, settingArtifactSchema, beatArtifactSchema } from '@agent4novel/contracts'
import type { CaptionContent, CreativeContent, OutlineContent, WorkView } from '@agent4novel/contracts'
import { advance, getWork } from '../api.js'
import { btnPrimary, btnSecondary, cardStyle } from '../ui.js'
import CreativePoster from './CreativePoster.js'
import OutlineReview from './OutlineReview.js'
import SettingReview from './SettingReview.js'
import { initSettingReview, isSettingDirty, reduceSettingReview, type SettingReviewAction, type SettingReviewState } from '../setting-review.js'
import { confirmSettingApproval, finishSettingApproval } from '../setting-api.js'
import { ConfirmDialog } from '../ConfirmDialog.js'
import BeatReview from './BeatReview.js'
import { initBeatReview, isBeatDirty, reduceBeatReview, type BeatReviewState, type BeatReviewAction } from '../beat-review.js'
import { postBeatCommand } from '../beat-api.js'

// Workspace 只渲染 server 读模型(workflowState/allowedActions 来自 GET /works/:id 同快照),
// 不在前端重建状态机。生成/重试 = 同一个 advance(幂等,从失败步骤恢复)。
export default function Workspace({ workId, onBack }: { workId: string; onBack: () => void }) {
  const [work, setWork] = useState<WorkView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState<string | null>(null)
  const [setting, setSettingState] = useState<SettingReviewState | null>(null)
  const [beat, setBeatState] = useState<BeatReviewState | null>(null)
  const beatRef = useRef<BeatReviewState | null>(null)
  const [leaving, setLeaving] = useState(false)
  const settingRef = useRef<SettingReviewState | null>(null)
  const workRef = useRef<WorkView | null>(null)
  const mounted = useRef(false)
  const readSequence = useRef(0)
  const commandSequence = useRef(0)
  const generationBusy = useRef(false)
  const navigated = useRef(false)
  const setBeat = useCallback((next: BeatReviewState) => { beatRef.current = next; setBeatState(next) }, [])
  const setSetting = useCallback((next: SettingReviewState) => {
    settingRef.current = next
    setSettingState(next)
  }, [])
  const acceptWork = useCallback((view: WorkView, observe = true) => {
    const currentBeat = beatRef.current
    const oldHead = currentBeat?.observedWork?.artifacts.find(a => a.kind === 'beat' && a.chapter === 1) ?? currentBeat?.baseline
    const newHead = view.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)
    if (oldHead && !newHead) return
    if (oldHead && newHead && (newHead.version < oldHead.version || (newHead.id === oldHead.id && newHead.version === oldHead.version
      && oldHead.humanStatus === 'approved' && newHead.humanStatus === 'pending'))) return
    workRef.current = view
    setWork(view)
    const current = settingRef.current
    const candidate = settingArtifactSchema.safeParse(view.artifacts.find((artifact) => artifact.kind === 'setting')).data
    if (!current && candidate?.workId === view.id) setSetting(initSettingReview(candidate))
    else if (current && observe) setSetting(reduceSettingReview(current, { type: 'observe-work', work: view }))
    const beatCandidate = beatArtifactSchema.safeParse(newHead).data
    if (!currentBeat && beatCandidate?.workId === view.id) setBeat({ ...initBeatReview(beatCandidate), observedWork: view })
    else if (currentBeat && observe) setBeat(reduceBeatReview(currentBeat, { type: 'observe', work: view }))
  }, [setSetting, setBeat])

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
  const dirty = (setting !== null && (isSettingDirty(setting) || setting.hasUnknownWrite || ['submitting', 'reconciling'].includes(setting.phase)))
    || (beat !== null && isBeatDirty(beat)) || generating
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
        setError(`生成失败(${outcome.code})${outcome.retryable ? ',可重试' : ''}${outcome.inputBudget ? `；完整输入 ${outcome.inputBudget.actualLength} / ${outcome.inputBudget.limit} 字符，未调用模型。请缩减输入或检查模型配置。` : ''}`)
      }
      await refresh()
    } catch {
      if (mounted.current) {
        setError('生成结果尚未确认，正在核对服务器。已发出的请求可能继续处理。')
        await refresh()
      }
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
    if (result.state.phase === 'approved' && current.phase !== 'approved') await continueAfterApproval()
  }
  const beatAction = (action: BeatReviewAction) => { if (beatRef.current) setBeat(reduceBeatReview(beatRef.current, action)) }
  const runBeat = async (mode: 'approve-beat' | 'regenerate-beat' | 'confirm' | 'retry') => {
    const current = beatRef.current
    if (!current || ['submitting', 'regenerating', 'reconciling'].includes(current.phase)) return
    if ((mode === 'approve-beat' || mode === 'regenerate-beat') && (workRef.current?.workflowState !== 'awaiting-beat-review'
      || !workRef.current.allowedActions.includes(mode === 'approve-beat' ? 'approve' : 'regenerate'))) return
    const next = reduceBeatReview(current, mode === 'confirm' || mode === 'retry' ? { type: mode } : { type: 'start', operation: mode })
    setBeat(next)
    if (mode !== 'confirm' && (!next.submitted || !['submitting', 'regenerating'].includes(next.phase))) return
    const sequence = ++commandSequence.current
    readSequence.current++
    const active = () => mounted.current && sequence === commandSequence.current
    if (mode !== 'confirm') {
      let response: { status: number; body: unknown } | undefined
      try { response = await postBeatCommand(workId, next.submitted!) } catch { /* unknown outcome, reconcile once */ }
      if (!active()) return
      const updated = reduceBeatReview(beatRef.current!, { type: 'result', response })
      setBeat(updated)
      if (!updated.submitted) { await refresh(); return }
    }
    if (!active()) return
    setBeat(reduceBeatReview(beatRef.current!, { type: 'confirm' }))
    let view: WorkView | undefined
    try { view = await getWork(workId) } catch { /* preserve the frozen request */ }
    if (!active()) return
    setBeat(reduceBeatReview(beatRef.current!, { type: 'readback', work: view }))
    if (view?.id === workId) acceptWork(view, false)
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
  const showBeat = beat !== null && (work?.workflowState === 'awaiting-beat-review' || work?.workflowState === 'beat-approved')
  const nextStep = generating ? generationStep : work?.nextStepId
  const stepLabel = nextStep === 'beat' ? '第一章章纲' : nextStep === 'setting' ? '设定' : nextStep === 'outline' ? '大纲' : '创意稿'

  return (
    <main style={{ padding: 24, maxWidth: 860 }}>
      <button
        onClick={() => { if (dirty) setLeaving(true); else if (!navigated.current) { navigated.current = true; onBack() } }}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {error && <button type="button" style={btnSecondary} onClick={() => void refresh()}>刷新作品</button>}

      {work && !showPoster && !showOutline && !showSetting && !showBeat && (
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
      {showBeat && beat && <BeatReview state={beat} onAction={beatAction}
        allowCommands={work?.workflowState === 'awaiting-beat-review' && work.allowedActions.includes('approve') && work.allowedActions.includes('regenerate')}
        onApprove={() => void runBeat('approve-beat')} onRegenerate={() => void runBeat('regenerate-beat')}
        onConfirm={() => void runBeat('confirm')} onRetry={() => void runBeat('retry')} />}
      {beat && !showBeat && beat.phase !== 'approved' && <p className="setting-notice">章纲的本页修改与意见仍保留。完成前置关卡后可继续查看。</p>}
      {setting && !showSetting && setting.phase !== 'approved' && <p className="setting-notice">设定的本页修改仍保留。完成前置关卡后可继续查看。</p>}
      {leaving && <ConfirmDialog title="离开当前创作页面？" description="离开会放弃本页修改和意见；已发送的请求可能继续处理。"
        cancelLabel="继续编辑" confirmLabel="放弃修改并离开" onCancel={() => setLeaving(false)} onConfirm={() => {
          commandSequence.current++
          readSequence.current++
          setLeaving(false)
          if (!navigated.current) { navigated.current = true; onBack() }
        }} />}
    </main>
  )
}
