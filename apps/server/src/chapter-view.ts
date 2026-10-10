import { beatContentSchema, type Artifact, type ChapterSummary, type WorkDetail, type WorkflowState } from '@agent4novel/contracts'

export function currentChapterOf(work: WorkDetail): number {
  return work.artifacts.reduce((max, artifact) => Math.max(max, artifact.chapter ?? 1), 1)
}

// Continuity is a warning, not a new approval state. A saved edit keeps the
// original input references; later chapters remain intact and display drift.
export function chapterSummaries(work: WorkDetail, allowStart: boolean): ChapterSummary[] {
  const heads = new Map(work.artifacts.map(a => [`${a.kind}:${a.chapter ?? ''}`, a]))
  const numbers = [...new Set(work.artifacts.flatMap(a => a.chapter === undefined ? [] : [a.chapter]))].sort((a, b) => a - b)
  const current = currentChapterOf(work)
  let previousNeedsReview = false
  const stale = (artifact: Artifact | undefined) => artifact?.inputs?.some(ref => {
    const actual = heads.get(`${ref.kind}:${ref.chapter ?? ''}`)
    return !actual || actual.id !== ref.artifactId || actual.version !== ref.version || actual.humanStatus !== 'approved'
  }) ?? false
  return numbers.map(chapter => {
    const beat = heads.get(`beat:${chapter}`), prose = heads.get(`prose:${chapter}`)
    const needsContinuityReview = previousNeedsReview || stale(beat) || stale(prose)
    previousNeedsReview = needsContinuityReview
    const proseBeatInput = prose?.inputs?.find(ref => ref.kind === 'beat' && ref.chapter === chapter)
    const proseFollowsBeat = !!beat && !!proseBeatInput && proseBeatInput.artifactId === beat.id && proseBeatInput.version === beat.version
    const approvedPair = beat?.humanStatus === 'approved' && prose?.humanStatus === 'approved'
    const replanned = approvedPair && !!proseBeatInput && !proseFollowsBeat
    const allowedActions = beat?.humanStatus === 'pending' ? ['approve', 'regenerate']
      : prose?.humanStatus === 'pending' ? ['save-draft', 'approve', 'regenerate']
        : replanned ? ['save-draft', 'regenerate-chapter-prose']
          : approvedPair ? ['save-draft', 'regenerate-chapter']
            : prose?.humanStatus === 'approved' ? ['save-draft']
              : chapter !== current ? []
                : beat?.humanStatus === 'approved' ? ['generate'] : []
    if (allowStart && chapter === current && prose?.humanStatus === 'approved') allowedActions.push('start-next-chapter')
    return { chapter, title: beatContentSchema.safeParse(beat?.content).data?.title ?? `第${chapter}章`,
      beatStatus: beat?.humanStatus ?? null, proseStatus: prose?.humanStatus ?? null, allowedActions, needsContinuityReview }
  })
}

export function chapterWorkflow(work: WorkDetail, chapter: number, allowStart: boolean): {
  workflowState: WorkflowState; nextStepId: null; allowedActions: string[]
} | null {
  const summary = chapterSummaries(work, allowStart).find(item => item.chapter === chapter)
  if (!summary) return null
  const workflowState: WorkflowState = summary.beatStatus === 'pending' ? 'awaiting-beat-review'
    : summary.proseStatus === 'pending' ? 'awaiting-prose-review'
      : summary.proseStatus === 'approved' ? 'prose-approved'
        : summary.beatStatus === 'approved' ? 'beat-approved' : 'ready-to-generate'
  return { workflowState, nextStepId: null, allowedActions: summary.allowedActions }
}
