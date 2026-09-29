import { useCallback, useEffect, useRef, useState } from 'react'
import { captionContentSchema, creativeContentSchema, outlineContentSchema, settingArtifactSchema, beatArtifactSchema, proseArtifactSchema } from '@agent4novel/contracts'
import type { CaptionContent, CreativeContent, OutlineContent, WorkView } from '@agent4novel/contracts'
import { advance, getWork, startChapter, type StartChapterRequest } from '../api.js'
import { chapterActions, chapterLabel } from '../chapter-view.js'
import ReferenceMaterials from './ReferenceMaterials.js'
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
import ProseReview from './ProseReview.js'
import { initProseReview, isProseDirty, reduceProseReview, type ProseReviewState, type ProseReviewAction } from '../prose-review.js'
import { postProseCommand } from '../prose-api.js'

// Workspace 只渲染 server 读模型(workflowState/allowedActions 来自 GET /works/:id 同快照),
// 不在前端重建状态机。当前章生成/重试走 advance，开始下一章走独立条件请求。
type WorkspaceProps = { workId: string; onBack: () => void; initialChapter?: number; onChapterChange?: (chapter: number) => void }
export default function Workspace(props: WorkspaceProps) {
  return <WorkNavigation key={props.workId} {...props} />
}
function WorkNavigation(props: WorkspaceProps) {
  const [selectedChapter, setSelectedChapter] = useState(props.initialChapter)
  const locationCallback = useRef(props.onChapterChange)
  locationCallback.current = props.onChapterChange
  const syncChapter = useCallback((chapter: number) => locationCallback.current?.(chapter), [])
  const selectChapter = useCallback((chapter: number) => { setSelectedChapter(chapter); syncChapter(chapter) }, [syncChapter])
  return <WorkSession key={`${props.workId}:${selectedChapter ?? 'current'}`} workId={props.workId} onBack={props.onBack}
    requestedChapter={selectedChapter} onSelectChapter={selectChapter} onResolvedChapter={syncChapter} />
}
function WorkSession({ workId, onBack, requestedChapter, onSelectChapter, onResolvedChapter }: {
  workId: string; onBack: () => void; requestedChapter?: number; onSelectChapter: (chapter: number) => void; onResolvedChapter: (chapter: number) => void
}) {
  const chapterRef = useRef<number | null>(null)
  const [switchingTo, setSwitchingTo] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [startUncertain, setStartUncertain] = useState(false)
  const frozenStart = useRef<StartChapterRequest | null>(null)
  const [work, setWork] = useState<WorkView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationUncertain, setGenerationUncertain] = useState(false)
  const uncertainGeneration = useRef<{ kind: string; chapter?: number } | null>(null)
  const [generationStep, setGenerationStep] = useState<string | null>(null)
  const [setting, setSettingState] = useState<SettingReviewState | null>(null)
  const [beat, setBeatState] = useState<BeatReviewState | null>(null)
  const beatRef = useRef<BeatReviewState | null>(null)
  const [prose, setProseState] = useState<ProseReviewState | null>(null)
  const proseRef = useRef<ProseReviewState | null>(null)
  const setProse = useCallback((next: ProseReviewState) => { proseRef.current = next; setProseState(next) }, [])
  const [leaving, setLeaving] = useState(false)
  const settingRef = useRef<SettingReviewState | null>(null)
  const workRef = useRef<WorkView | null>(null)
  const mounted = useRef(false)
  const readSequence = useRef(0)
  const commandSequence = useRef(0)
  const generationBusy = useRef(false)
  const navigated = useRef(false)
  const continuedBeat = useRef<string | null>(null)
  const setBeat = useCallback((next: BeatReviewState) => { beatRef.current = next; setBeatState(next) }, [])
  const setSetting = useCallback((next: SettingReviewState) => {
    settingRef.current = next
    setSettingState(next)
  }, [])
  const acceptWork = useCallback((view: WorkView, observe = true) => {
    if (chapterRef.current === null) {
      const exists = requestedChapter === undefined || requestedChapter === view.currentChapter || view.chapters.some(item => item.chapter === requestedChapter)
      chapterRef.current = exists ? requestedChapter ?? view.currentChapter : view.currentChapter
      if (!exists) setError(`${chapterLabel(requestedChapter!)}尚不存在，已打开当前章节。`)
      onResolvedChapter(chapterRef.current)
    }
    const chapter = chapterRef.current
    const currentBeat = beatRef.current
    const oldHead = currentBeat?.observedWork?.artifacts.find(a => a.kind === 'beat' && a.chapter === chapter) ?? currentBeat?.baseline
    const newHead = view.artifacts.find(a => a.kind === 'beat' && a.chapter === chapter)
    if (oldHead && !newHead) return false
    if (oldHead && newHead && (newHead.version < oldHead.version || (newHead.id === oldHead.id && newHead.version === oldHead.version
      && oldHead.humanStatus === 'approved' && newHead.humanStatus === 'pending'))) return false
    const currentProse = proseRef.current
    const observedProse = currentProse?.observedWork?.artifacts.find(a => a.kind === 'prose' && a.chapter === chapter)
    const oldProse = observedProse && currentProse && observedProse.version > currentProse.baseline.version ? observedProse : currentProse?.baseline
    const newProse = view.artifacts.find(a => a.kind === 'prose' && a.chapter === chapter)
    if (oldProse && (!newProse || newProse.version < oldProse.version || (newProse.id === oldProse.id && newProse.version === oldProse.version
      && oldProse.humanStatus === 'approved' && newProse.humanStatus === 'pending'))) return false
    workRef.current = view
    setWork(view)
    const pendingGeneration = uncertainGeneration.current
    if (pendingGeneration && view.artifacts.some(artifact => artifact.kind === pendingGeneration.kind && artifact.chapter === pendingGeneration.chapter)) {
      uncertainGeneration.current = null
      setGenerationUncertain(false)
      setError(null)
    }
    const current = settingRef.current
    const candidate = settingArtifactSchema.safeParse(view.artifacts.find((artifact) => artifact.kind === 'setting')).data
    if (!current && candidate?.workId === view.id) setSetting(initSettingReview(candidate))
    else if (current && observe) setSetting(reduceSettingReview(current, { type: 'observe-work', work: view }))
    const beatCandidate = beatArtifactSchema.safeParse(newHead).data
    if (!currentBeat && beatCandidate?.workId === view.id) setBeat({ ...initBeatReview(beatCandidate), observedWork: view })
    else if (currentBeat && observe) setBeat(reduceBeatReview(currentBeat, { type: 'observe', work: view }))
    const proseCandidate = proseArtifactSchema.safeParse(newProse).data
    if (!currentProse && proseCandidate?.workId === view.id) setProse({ ...initProseReview(proseCandidate), observedWork: view })
    else if (currentProse && observe) setProse(reduceProseReview(currentProse, { type: 'observe', work: view }))
    return true
  }, [setSetting, setBeat, setProse, requestedChapter, onResolvedChapter])

  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current
    try {
      const view = await getWork(workId)
      if (!mounted.current || sequence !== readSequence.current || view.id !== workId) return null
      return acceptWork(view) ? view : null
    } catch {
      if (mounted.current && sequence === readSequence.current) setError(uncertainGeneration.current
        ? '生成结果尚未确认，读取作品失败，请重试核对。' : '读取作品失败，请重试。')
      return null
    }
  }, [workId, acceptWork])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; readSequence.current++; commandSequence.current++ }
  }, [refresh])
  const dirty = (setting !== null && (isSettingDirty(setting) || setting.hasUnknownWrite || ['submitting', 'reconciling'].includes(setting.phase)))
    || (beat !== null && isBeatDirty(beat)) || (prose !== null && isProseDirty(prose)) || generating || generationUncertain || starting || startUncertain
  const navigationLocked = generating || generationUncertain || starting || startUncertain
    || !!prose && (prose.hasUnknownWrite || ['saving', 'submitting', 'regenerating', 'reconciling'].includes(prose.phase))
    || !!beat && (beat.hasUnknownWrite || ['submitting', 'regenerating', 'reconciling'].includes(beat.phase))
    || !!setting && (setting.hasUnknownWrite || ['submitting', 'reconciling'].includes(setting.phase))
  const chooseChapter = (chapter: number) => {
    if (navigationLocked || chapter === chapterRef.current) return
    if (dirty) setSwitchingTo(chapter)
    else onSelectChapter(chapter)
  }
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const generate = useCallback(async (stepId = workRef.current?.nextStepId ?? null) => {
    if (generationBusy.current || uncertainGeneration.current || !stepId) return
    const target = { kind: stepId, ...(stepId === 'beat' || stepId === 'prose' ? { chapter: workRef.current?.currentChapter } : {}) }
    const markUnknown = () => {
      uncertainGeneration.current = target
      setGenerationUncertain(true)
      setError('生成结果尚未确认，请刷新作品核对。已发出的请求可能继续处理；确认前不会再次生成或切换章节。')
    }
    generationBusy.current = true
    setGenerationStep(stepId)
    setError(null)
    setGenerating(true)
    try {
      const outcome = await advance(workId)
      if (!mounted.current) return
      if (outcome.kind === 'failed' && (outcome.beatCommand?.writeOutcome === 'unknown' || outcome.proseCommand?.writeOutcome === 'unknown')) {
        markUnknown()
      } else if (outcome.kind === 'failed') {
        setError(`生成失败(${outcome.code})${outcome.retryable ? ',可重试' : ''}${outcome.inputBudget ? `；完整输入 ${outcome.inputBudget.actualLength} / ${outcome.inputBudget.limit} 字符，未调用模型。请缩减输入或检查模型配置。` : ''}`)
      }
      await refresh()
    } catch (error) {
      if (mounted.current) {
        const status = (error as { status?: number }).status
        if (status !== undefined && status >= 400 && status < 500) setError('本次生成请求被拒绝，请核对作品后重试。')
        else markUnknown()
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
  const continueAfterBeat = async (readback?: WorkView | null) => {
    const approved = beatRef.current
    if (approved?.phase !== 'approved') { await refresh(); return }
    const key = `${approved.baseline.id}:${approved.baseline.version}`
    const view = readback === undefined ? await refresh() : readback
    if (view?.currentChapter === approved.baseline.chapter && view.nextStepId === 'prose'
      && chapterActions(view, approved.baseline.chapter).includes('generate') && continuedBeat.current !== key) {
      continuedBeat.current = key
      await generate('prose')
    }
  }
  const beatAction = (action: BeatReviewAction) => { if (beatRef.current) setBeat(reduceBeatReview(beatRef.current, action)) }
  const runBeat = async (mode: 'approve-beat' | 'regenerate-beat' | 'confirm' | 'retry') => {
    const current = beatRef.current
    if (!current || ['submitting', 'regenerating', 'reconciling'].includes(current.phase)) return
    if ((mode === 'approve-beat' || mode === 'regenerate-beat') && !chapterActions(workRef.current, current.baseline.chapter).includes(mode === 'approve-beat' ? 'approve' : 'regenerate')) return
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
      if (!updated.submitted) { await continueAfterBeat(); return }
    }
    if (!active()) return
    setBeat(reduceBeatReview(beatRef.current!, { type: 'confirm' }))
    let view: WorkView | undefined
    try { view = await getWork(workId) } catch { /* preserve the frozen request */ }
    if (!active()) return
    setBeat(reduceBeatReview(beatRef.current!, { type: 'readback', work: view }))
    const accepted = view?.id === workId && acceptWork(view, false)
    if (beatRef.current?.phase === 'approved' && current.phase !== 'approved') await continueAfterBeat(accepted ? view : null)
  }

  const proseAction = (action: ProseReviewAction) => { if (proseRef.current) setProse(reduceProseReview(proseRef.current, action)) }
  const runProse = async (mode: 'approve-prose' | 'regenerate-prose' | 'save-prose' | 'confirm' | 'retry') => {
    const current = proseRef.current
    if (!current || starting || startUncertain || ['saving', 'submitting', 'regenerating', 'reconciling'].includes(current.phase)) return
    if (mode === 'save-prose' && !chapterActions(workRef.current, current.baseline.chapter).includes('save-draft')) return
    if ((mode === 'approve-prose' || mode === 'regenerate-prose') && !chapterActions(workRef.current, current.baseline.chapter).includes(mode === 'approve-prose' ? 'approve' : 'regenerate')) return
    const next = reduceProseReview(current, mode === 'confirm' || mode === 'retry' ? { type: mode } : { type: 'start', operation: mode })
    setProse(next)
    if (mode !== 'confirm' && (!next.submitted || !['saving', 'submitting', 'regenerating'].includes(next.phase))) return
    const sequence = ++commandSequence.current
    readSequence.current++
    const active = () => mounted.current && sequence === commandSequence.current
    if (mode !== 'confirm') {
      let response: { status: number; body: unknown } | undefined
      try { response = await postProseCommand(workId, next.submitted!) } catch { /* unknown outcome, reconcile once */ }
      if (!active()) return
      const updated = reduceProseReview(proseRef.current!, { type: 'result', response })
      setProse(updated)
      if (!updated.submitted) { await refresh(); return }
    }
    if (!active()) return
    setProse(reduceProseReview(proseRef.current!, { type: 'confirm' }))
    let view: WorkView | undefined
    try { view = await getWork(workId) } catch { /* preserve the frozen request */ }
    if (!active()) return
    setProse(reduceProseReview(proseRef.current!, { type: 'readback', work: view }))
    if (view?.id === workId) acceptWork(view, false)
  }

  const beginNextChapter = async () => {
    const current = proseRef.current
    if (!current || generationBusy.current || starting || isProseDirty(current)) return
    if (!frozenStart.current && !chapterActions(workRef.current, current.baseline.chapter).includes('start-next-chapter')) return
    const request = frozenStart.current ?? { chapter: current.baseline.chapter + 1,
      expectedPreviousProseId: current.baseline.id, expectedPreviousProseVersion: current.baseline.version }
    frozenStart.current = request
    generationBusy.current = true
    setStarting(true)
    setError(null)
    try {
      const outcome = await startChapter(workId, request)
      if (!mounted.current) return
      const unknown = outcome.kind === 'failed' && (startUncertain || outcome.beatCommand?.writeOutcome === 'unknown')
      setStartUncertain(unknown)
      if (!unknown) frozenStart.current = null
      if (unknown) setError('开始下一章的结果尚未确认。可核对服务器，或重试同一份开始请求。')
      else if (outcome.kind === 'failed') setError(`下一章生成失败（${outcome.code}）${outcome.retryable ? '，可重试。' : '，请核对作品后重试。'}`)
      const view = await refresh()
      if (mounted.current && view?.chapters.some(item => item.chapter === request.chapter)) onSelectChapter(request.chapter)
    } catch (error) {
      if (!mounted.current) return
      const failure = error as { status?: number; code?: string }
      // A new request rejected before execution is known not to have started a chapter.
      // Rejection of a retry cannot settle an earlier request whose response was lost.
      const rejected = !startUncertain && failure.status !== undefined && failure.status >= 400 && failure.status < 500
      setStartUncertain(!rejected)
      if (rejected) frozenStart.current = null
      setError(rejected ? `未开始下一章（${failure.code ?? failure.status}），请核对作品后重试。`
        : '开始下一章的结果尚未确认。可核对服务器，或重试同一份开始请求。')
      const view = await refresh()
      if (mounted.current && view?.chapters.some(item => item.chapter === request.chapter)) {
        frozenStart.current = null
        setStartUncertain(false)
        onSelectChapter(request.chapter)
      }
    } finally {
      generationBusy.current = false
      if (mounted.current) setStarting(false)
    }
  }
  const confirmStart = async () => {
    const target = frozenStart.current?.chapter
    const view = await refresh()
    if (mounted.current && target && view?.chapters.some(item => item.chapter === target)) onSelectChapter(target)
  }

  const autosaveRef = useRef(runProse)
  autosaveRef.current = runProse
  useEffect(() => {
    if (!prose || !['editing', 'approved'].includes(prose.phase) || prose.draft.text === prose.baseline.content.text
      || starting || startUncertain || !chapterActions(work, prose.baseline.chapter).includes('save-draft')) return
    const timer = setTimeout(() => { void autosaveRef.current('save-prose') }, 600)
    return () => clearTimeout(timer)
  }, [prose?.draft.text, prose?.baseline.id, prose?.baseline.version, prose?.phase, work, starting, startUncertain])

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

  const chapter = chapterRef.current ?? requestedChapter ?? 1
  const chapterSummary = work?.chapters.find(item => item.chapter === chapter)
  const actions = chapterActions(work, chapter)
  const isCurrentChapter = chapter === work?.currentChapter
  const state = generating ? 'generating' : (work?.workflowState ?? 'ready-to-generate')
  const showOutline =
    (work?.workflowState === 'awaiting-outline-review' || work?.workflowState === 'outline-approved') &&
    outline !== null &&
    outlineArtifact !== undefined

  const showSetting = setting !== null && (work?.workflowState === 'awaiting-setting-review' || work?.workflowState === 'setting-approved')
  const showProse = prose !== null && (!!chapterSummary || work?.workflowState === 'awaiting-prose-review' || work?.workflowState === 'prose-approved')
  const showBeat = beat !== null && !showProse && (!!chapterSummary || work?.workflowState === 'awaiting-beat-review' || work?.workflowState === 'beat-approved')
  // 生成间隙保留已选定的创意稿；动作权限仍由服务器读模型决定。
  const showPoster = creative !== null && creativeArtifact !== undefined && (
    work?.workflowState === 'awaiting-selection' || (
      creativeArtifact.humanStatus === 'approved' && !showOutline && !showSetting && !showBeat && !showProse &&
      (work?.workflowState === 'ready-to-generate' || work?.workflowState === 'failed')
    )
  )
  const nextStep = generating ? generationStep : work?.nextStepId
  const stepLabel = nextStep === 'prose' ? `${chapterLabel(chapter)}正文` : nextStep === 'beat' ? `${chapterLabel(chapter)}章纲` : nextStep === 'setting' ? '设定' : nextStep === 'outline' ? '大纲' : '创意稿'

  return (
    <main style={{ padding: 24, maxWidth: 860 }}>
      <button
        onClick={() => { if (dirty) setLeaving(true); else if (!navigated.current) { navigated.current = true; onBack() } }}
        style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, marginBottom: 16 }}
      >
        ← 返回书架
      </button>
      {work && <h1>{work.title}</h1>}
      {!!work?.chapters.length && <nav aria-label="章节目录" className="chapter-directory">
        <h2>章节目录</h2><div className="setting-actions">{work.chapters.map(item => <button type="button" key={item.chapter}
          data-chapter={item.chapter} aria-current={item.chapter === chapter ? 'page' : undefined}
          disabled={navigationLocked} onClick={() => chooseChapter(item.chapter)} style={btnSecondary}>
          {chapterLabel(item.chapter)} · {item.title} · {item.proseStatus === 'approved' ? '已通过' : item.proseStatus === 'pending' ? '正文待通过' : item.beatStatus === 'pending' ? '章纲待通过' : '待生成正文'}
          {item.chapter === work.currentChapter ? '（当前章）' : ''}{item.needsContinuityReview ? ' · 待检查衔接' : ''}
        </button>)}</div>
        <p className="setting-muted">{isCurrentChapter ? '正在创作当前章。' : '正在阅读历史章节。'}{navigationLocked ? '请先完成当前操作或核对服务器结果，再切换章节。' : ''}</p>
      </nav>}
      {chapterSummary?.needsContinuityReview && <p className="setting-notice" role="status">前章正文已修改，请检查本章衔接。后续章节已保留，不会自动重写。</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {error && <button type="button" style={btnSecondary} onClick={() => void (startUncertain ? confirmStart() : refresh())}>刷新作品</button>}

      {work && !showPoster && !showOutline && !showSetting && !showBeat && !showProse && (
        <section style={{ ...cardStyle, marginBottom: 16, background: 'var(--bg-sunken)' }}>
          <strong style={{ color: 'var(--ink-2)' }}>脑洞（seed）</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{work.seed}</p>
        </section>
      )}

      {isCurrentChapter && (state === 'ready-to-generate' || state === 'failed') && work?.allowedActions.includes('generate') && (
        <button onClick={() => void generate()} disabled={generating || generationUncertain} style={btnPrimary}>
          {state === 'failed' ? `重试生成${stepLabel}` : `生成${stepLabel}`}
        </button>
      )}
      {state === 'generating' && (
        <p style={{ color: 'var(--ink-2)' }}>正在生成{stepLabel}……</p>
      )}

      {showPoster && creativeArtifact && (
        <CreativePoster
          key={`${creativeArtifact.id}:${creativeArtifact.version}`}
          workId={workId}
          content={creative as CreativeContent}
          headVersion={creativeArtifact.version}
          caption={caption}
          readonly={generating || work?.workflowState !== 'awaiting-selection' || !work.allowedActions.includes('select')}
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
        allowCommands={actions.includes('approve') && actions.includes('regenerate')}
        onApprove={() => void runBeat('approve-beat')} onRegenerate={() => void runBeat('regenerate-beat')}
        onConfirm={() => void runBeat('confirm')} onRetry={() => void runBeat('retry')} />}
      {showProse && prose && <ProseReview title={beat?.baseline.content.title ?? chapterLabel(chapter)} state={prose} onAction={proseAction}
        allowCommands={!starting && !startUncertain && (actions.includes('save-draft') || (actions.includes('approve') && actions.includes('regenerate')))}
        onApprove={() => void runProse('approve-prose')} onRegenerate={() => void runProse('regenerate-prose')}
        onConfirm={() => void runProse('confirm')} onRetry={() => void runProse('retry')} />}
      {showProse && prose && (actions.includes('start-next-chapter') || startUncertain) && <section style={{ marginTop: 24 }}>
        <button type="button" style={btnPrimary} disabled={starting || generating || isProseDirty(prose)} onClick={() => void beginNextChapter()}>
          {starting ? '正在生成下一章章纲…' : startUncertain ? '重试开始下一章' : '开始下一章'}
        </button>
        <p className="setting-muted">先生成下一章章纲，把关后再生成正文。{isProseDirty(prose) ? '请先保存并确认本章修改。' : ''}</p>
      </section>}
      {work && <ReferenceMaterials key={chapter} work={work} chapter={chapter} hiddenKinds={[
        ...(!showPoster && !showOutline && !showSetting && !showBeat && !showProse ? ['seed'] : []),
        ...(showPoster ? ['creative', 'caption'] : []), ...(showOutline ? ['outline'] : []), ...(showSetting ? ['setting'] : []), ...(showBeat ? ['beat'] : []),
      ]} />}
      {switchingTo !== null && <ConfirmDialog title="切换章节？" description="切换会放弃当前章尚未保存的修改和意见。"
        cancelLabel="继续编辑" confirmLabel="放弃修改并切换" onCancel={() => setSwitchingTo(null)} onConfirm={() => {
          if (navigationLocked) { setSwitchingTo(null); return }
          commandSequence.current++
          readSequence.current++
          onSelectChapter(switchingTo)
        }} />}
      {prose && !showProse && prose.phase !== 'approved' && <p className="setting-notice">正文的本页修改与意见仍保留。完成前置关卡后可继续查看。</p>}
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
