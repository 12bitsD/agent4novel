import { proseArtifactSchema, proseApproveRequestSchema, proseSaveRequestSchema, type ProseApproveRequest, type ProseRegenerateRequest, type ProseSaveRequest, type HumanStatus } from '@agent4novel/contracts'
import { KnownError } from './errors.js'
import { consumeGuards } from './pipeline/consume-guards.js'
import { observeProse } from './prose-command.js'
import type { ArtifactPrecondition, WorkStore } from './store/work-store.js'

export function prepareProseReview(store: WorkStore, workId: string, request: Pick<ProseRegenerateRequest, 'chapter' | 'expectedArtifactId' | 'expectedHeadVersion'>, expectedHumanStatus?: HumanStatus) {
  const work = store.getWork(workId)
  if (!work) throw new KnownError('work-not-found', 'work not found')
  const target = work.artifacts.find(a => a.kind === 'prose' && a.chapter === request.chapter)
  if (!target) throw new KnownError('artifact-not-found', 'prose not found')
  if (target.id !== request.expectedArtifactId || target.version !== request.expectedHeadVersion) throw new KnownError('version-conflict', 'prose head changed')
  if (expectedHumanStatus !== undefined && target.humanStatus !== expectedHumanStatus) throw new KnownError('version-conflict', 'prose review state changed')
  if (expectedHumanStatus === undefined && target.humanStatus !== 'pending') throw new KnownError('artifact-already-approved', 'prose already approved')
  const preconditions: ArtifactPrecondition[] = []
  for (const kind of ['caption', 'creative', 'outline', 'setting', 'beat'] as const) {
    const chapter = kind === 'beat' ? request.chapter : undefined
    const upstream = work.artifacts.find(a => a.kind === kind && a.chapter === chapter)
    try {
      if (!upstream || upstream.humanStatus !== 'approved') throw new Error('pending')
      consumeGuards[kind]?.(upstream.content)
    } catch { throw new KnownError('prose-gate-not-ready', 'approve the earlier valid gate first') }
    preconditions.push({ kind, chapter, head: { artifactId: upstream.id, version: upstream.version, humanStatus: 'approved' } })
  }
  const baseline = proseArtifactSchema.safeParse(target)
  if (!baseline.success) throw new KnownError('prose-gate-not-ready', 'invalid stored prose')
  return { work, baseline: baseline.data, preconditions }
}

export function saveProse(store: WorkStore, workId: string, request: ProseSaveRequest) {
  return observeProse(workId, 'save-prose', { artifactId: request.expectedArtifactId, version: request.expectedHeadVersion, humanStatus: request.expectedHumanStatus }, execution => {
    const { baseline, preconditions } = prepareProseReview(store, workId, request, request.expectedHumanStatus)
    execution.stage = 'input'
    const content = proseSaveRequestSchema.parse(request).content
    execution.stage = 'commit'
    return store.saveArtifact({ workId, kind: 'prose', chapter: request.chapter,
      expectedArtifactId: baseline.id, expectedHeadVersion: baseline.version, expectedHumanStatus: request.expectedHumanStatus, content, preconditions,
    })
  }, request.chapter)
}

export function approveProse(store: WorkStore, workId: string, request: ProseApproveRequest) {
  return observeProse(workId, 'approve-prose', { artifactId: request.expectedArtifactId, version: request.expectedHeadVersion }, execution => {
    const { baseline, preconditions } = prepareProseReview(store, workId, request)
    execution.stage = 'input'
    const content = proseApproveRequestSchema.parse(request).content
    execution.stage = 'commit'
    return store.finalizeArtifact({ workId, kind: 'prose', chapter: request.chapter,
      expectedArtifactId: baseline.id, expectedHeadVersion: baseline.version, content, preconditions,
    })
  }, request.chapter)
}
