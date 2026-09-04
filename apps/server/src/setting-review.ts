import { settingContentSchema, type SettingApproveRequest, type SettingContent } from '@agent4novel/contracts'
import { z } from 'zod'
import { KnownError } from './errors.js'
import { consumeGuards } from './pipeline/consume-guards.js'
import type { ArtifactPrecondition, WorkStore } from './store/work-store.js'
import { assignSettingIds } from './setting-content.js'

export class SettingValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super('invalid setting content')
  }
}

// 准备完整候选后交给 Store 一次条件写入；本模块没有分阶段保存或状态切换。
export function approveSetting(store: WorkStore, workId: string, request: SettingApproveRequest) {
  const work = store.getWork(workId)
  if (!work) throw new KnownError('work-not-found', 'work not found')
  const target = work.artifacts.find((artifact) => artifact.kind === 'setting')
  if (!target) throw new KnownError('artifact-not-found', 'setting not found')
  if (target.version !== request.expectedHeadVersion) {
    throw new KnownError('version-conflict', 'setting version changed')
  }
  if (target.humanStatus !== 'pending') {
    throw new KnownError('artifact-already-approved', 'setting already approved')
  }
  const preconditions: ArtifactPrecondition[] = []
  for (const kind of ['caption', 'creative', 'outline'] as const) {
    const artifact = work.artifacts.find((entry) => entry.kind === kind)
    if (!artifact || artifact.humanStatus !== 'approved') {
      throw new KnownError('setting-gate-not-ready', 'approve the earlier gate first')
    }
    try {
      consumeGuards[kind]?.(artifact.content)
    } catch {
      throw new KnownError('setting-gate-not-ready', 'approve the earlier gate first')
    }
    preconditions.push({
      kind,
      head: { artifactId: artifact.id, version: artifact.version, humanStatus: 'approved' },
    })
  }
  const baseline = settingContentSchema.parse(target.content)
  let content: SettingContent
  try {
    content = assignSettingIds(request.content, baseline)
  } catch (err) {
    if (err instanceof z.ZodError) throw new SettingValidationError(err.issues)
    throw err
  }
  return store.finalizeArtifact({
    workId,
    kind: 'setting',
    expectedArtifactId: target.id,
    expectedHeadVersion: request.expectedHeadVersion,
    content,
    preconditions,
  })
}
