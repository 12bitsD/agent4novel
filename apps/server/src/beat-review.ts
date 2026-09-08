import { beatArtifactSchema, beatApproveRequestSchema, type BeatApproveRequest, type BeatRegenerateRequest } from '@agent4novel/contracts'
import { KnownError } from './errors.js'
import { consumeGuards } from './pipeline/consume-guards.js'
import { observeBeat } from './beat-command.js'
import { assignBeatIds } from './beat-content.js'
import type { ArtifactPrecondition, WorkStore } from './store/work-store.js'

export function prepareBeatReview(store: WorkStore, workId: string, request: Pick<BeatRegenerateRequest, 'expectedArtifactId' | 'expectedHeadVersion'>) {
  const work = store.getWork(workId)
  if (!work) throw new KnownError('work-not-found', 'work not found')
  const target = work.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)
  if (!target) throw new KnownError('artifact-not-found', 'beat not found')
  if (target.id !== request.expectedArtifactId || target.version !== request.expectedHeadVersion) throw new KnownError('version-conflict', 'beat head changed')
  if (target.humanStatus !== 'pending') throw new KnownError('artifact-already-approved', 'beat already approved')
  const preconditions: ArtifactPrecondition[] = []
  for (const kind of ['caption', 'creative', 'outline', 'setting'] as const) {
    const upstream = work.artifacts.find(a => a.kind === kind && a.chapter === undefined)
    try {
      if (!upstream || upstream.humanStatus !== 'approved') throw new Error('pending')
      consumeGuards[kind]?.(upstream.content)
    } catch { throw new KnownError('beat-gate-not-ready', 'approve the earlier valid gate first') }
    preconditions.push({ kind, head: { artifactId: upstream.id, version: upstream.version, humanStatus: 'approved' } })
  }
  const baseline = beatArtifactSchema.safeParse(target)
  if (!baseline.success) throw new KnownError('beat-gate-not-ready', 'invalid stored beat')
  return { work, baseline: baseline.data, preconditions }
}

export function approveBeat(store: WorkStore, workId: string, request: BeatApproveRequest) {
  return observeBeat(workId, 'approve-beat', { artifactId: request.expectedArtifactId, version: request.expectedHeadVersion }, execution => {
    const { baseline, preconditions } = prepareBeatReview(store, workId, request)
    execution.stage = 'input'
    const content = assignBeatIds(beatApproveRequestSchema.parse(request).content, baseline.content)
    execution.stage = 'commit'
    return store.finalizeArtifact({ workId, kind: 'beat', chapter: 1,
      expectedArtifactId: baseline.id, expectedHeadVersion: baseline.version, content, preconditions,
    })
  })
}
