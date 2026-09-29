import { beatContentSchema, type Artifact, type ChapterSummary, type WorkDetail } from '@agent4novel/contracts'

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
    const allowedActions = prose?.humanStatus === 'approved' ? ['save-draft']
      : chapter !== current ? []
        : prose ? ['save-draft', 'approve', 'regenerate']
          : beat?.humanStatus === 'pending' ? ['approve', 'regenerate']
            : beat?.humanStatus === 'approved' ? ['generate'] : []
    if (allowStart && chapter === current && prose?.humanStatus === 'approved') allowedActions.push('start-next-chapter')
    return { chapter, title: beatContentSchema.safeParse(beat?.content).data?.title ?? `第${chapter}章`,
      beatStatus: beat?.humanStatus ?? null, proseStatus: prose?.humanStatus ?? null, allowedActions, needsContinuityReview }
  })
}
