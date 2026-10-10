import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  artifactSchema, settingContentSchema, settingExtensionProposeRequestSchema, settingExtensionActionRequestSchema,
  settingExtensionProposalRecordSchema, settingExtensionResourceSchema,
  type Artifact, type ArtifactRef, type SettingExtensionProposalRecord,
  type SettingExtensionProposeRequest, type SettingExtensionActionRequest, type SettingExtensionReceipt,
  type SettingExtensionResource, type WorkDetail,
} from '@agent4novel/contracts'
import { KnownError } from './errors.js'

export const refOf = (artifact: Artifact): ArtifactRef => ({ artifactId: artifact.id, version: artifact.version })
const sameRef = (a: ArtifactRef, b: ArtifactRef): boolean => a.artifactId === b.artifactId && a.version === b.version
const settingHead = (work: WorkDetail) => work.artifacts.find(a => a.kind === 'setting')
const pendingChapter = (work: WorkDetail) => work.artifacts.some(a => (a.kind === 'beat' || a.kind === 'prose') && a.humanStatus === 'pending')

// Readback validator shared by both stores. It deliberately accepts a
// historical candidate; the current Setting head is not its source of truth.
export function isValidApprovedExtensionCandidate(record: SettingExtensionProposalRecord, candidate: Artifact | undefined): boolean {
  if (record.status !== 'approved') return true
  if (!record.candidate || !candidate) return false
  if (candidate.workId !== record.workId || candidate.kind !== 'setting' || candidate.chapter !== undefined || candidate.humanStatus !== 'approved') return false
  if (!sameRef(record.candidate, { artifactId: candidate.id, version: candidate.version })) return false
  const content = settingContentSchema.safeParse(candidate.content)
  if (!content.success || !content.data.extensions.some(extension => isDeepStrictEqual(extension, record.extension))) return false
  return candidate.inputs?.some(input => input.kind === 'setting' && sameRef(input, record.expectedBase)) === true
}

export function extensionReceipt(record: SettingExtensionProposalRecord, operation: SettingExtensionReceipt['operation']): SettingExtensionReceipt {
  // Propose replay describes the original proposal creation, even after approval.
  return { requestId: record.requestId, workId: record.workId, operation,
    outcome: 'success', writeOutcome: 'committed', proposal: { workId: record.workId, requestId: record.requestId },
    candidate: operation === 'approve' ? record.candidate : null, errorCode: null }
}

export function extensionResource(work: WorkDetail, requestId: string, record?: SettingExtensionProposalRecord): SettingExtensionResource {
  const approved = new Set(work.artifacts.filter(a => a.kind === 'prose' && a.humanStatus === 'approved').map(a => a.chapter))
  const pending = new Set(work.artifacts.filter(a => (a.kind === 'beat' || a.kind === 'prose') && a.humanStatus === 'pending').map(a => a.chapter))
  const impact = { observedAt: new Date().toISOString(), approvedChapterCount: approved.size, pendingChapterCount: pending.size,
    continuityWarning: approved.size > 0, historicalArtifactsUnchanged: true, futureGeneration: 'uses-after-approval',
    automaticRewrite: false, existingFactMutation: false } as const
  const common = { kind: 'setting-extension', workId: work.id, requestId, impact } as const
  if (!record) return settingExtensionResourceSchema.parse({ ...common, status: 'none', proposal: null, base: null,
    extension: null, candidate: null, createdAt: null, updatedAt: null })
  const head = settingHead(work)
  const stale = record.status === 'pending' && (!head || head.humanStatus !== 'approved' || !sameRef(refOf(head), record.expectedBase))
  return settingExtensionResourceSchema.parse({ ...common, status: stale ? 'stale' : record.status,
    proposal: { workId: work.id, requestId }, base: record.expectedBase, extension: record.extension,
    candidate: record.candidate, createdAt: record.createdAt, updatedAt: record.updatedAt })
}

// The stores call these pure planners *inside* their atomic write boundary.
// Plans validate all content before either a proposal or canonical artifact is changed.
export function proposeExtension(work: WorkDetail, input: SettingExtensionProposeRequest, prior?: SettingExtensionProposalRecord): SettingExtensionProposalRecord {
  const parsed = settingExtensionProposeRequestSchema.safeParse(input)
  if (!parsed.success) throw new KnownError('invalid-input', 'invalid setting extension request')
  const request = parsed.data
  const persistedRequest = { ...request, workId: work.id }
  if (prior) {
    if (!isDeepStrictEqual(prior.request, persistedRequest)) throw new KnownError('setting-extension-request-conflict', 'request identity already used')
    return prior
  }
  const head = settingHead(work)
  if (!head || head.humanStatus !== 'approved' || !sameRef(refOf(head), request.expectedBase)) {
    throw new KnownError('setting-extension-base-conflict', 'setting base is not the current approved head')
  }
  if (pendingChapter(work)) throw new KnownError('setting-extension-chapter-pending', 'a chapter is pending review')
  const baseline = settingContentSchema.parse(head.content)
  const used = new Set([...baseline.world, ...baseline.characters, ...baseline.factions, ...baseline.relationships,
    ...baseline.extensions.flatMap(s => s.items)].map(i => i.itemId))
  baseline.extensions.forEach(s => used.add(s.sectionId))
  const id = (prefix: string) => {
    let value: string
    do { value = `${prefix}-${randomUUID()}` } while (used.has(value))
    used.add(value)
    return value
  }
  const extension = { sectionId: id('section'), title: request.extension.title,
    items: request.extension.items.map(item => ({ ...item, itemId: id('item') })) }
  if (!settingContentSchema.safeParse({ ...baseline, extensions: [...baseline.extensions, extension] }).success) {
    throw new KnownError('setting-extension-limit', 'merged setting exceeds logical limits')
  }
  const now = new Date().toISOString()
  return settingExtensionProposalRecordSchema.parse({ workId: work.id, requestId: request.requestId, request: persistedRequest,
    expectedBase: request.expectedBase, extension, status: 'pending', candidate: null, createdAt: now, updatedAt: now })
}

export function actOnExtension(work: WorkDetail, input: SettingExtensionActionRequest, record: SettingExtensionProposalRecord | undefined,
  operation: 'approve' | 'cancel'): { record: SettingExtensionProposalRecord; artifact?: Artifact } {
  const parsed = settingExtensionActionRequestSchema.safeParse(input)
  if (!parsed.success) throw new KnownError('invalid-input', 'invalid setting extension action')
  if (!record) throw new KnownError('setting-extension-not-found', 'setting extension not found')
  if (!sameRef(record.expectedBase, parsed.data.expectedBase)) throw new KnownError('setting-extension-stale', 'proposal base does not match')
  const terminal = operation === 'approve' ? 'approved' : 'cancelled'
  // Terminal replay precedes head/pending checks, but never the stored-base check.
  if (record.status === terminal) return { record }
  if (record.status !== 'pending') throw new KnownError('setting-extension-state-conflict', 'proposal is already terminal')
  const updatedAt = new Date().toISOString()
  if (operation === 'cancel') return { record: { ...record, status: 'cancelled', updatedAt } }
  const head = settingHead(work)
  if (!head || head.humanStatus !== 'approved' || !sameRef(refOf(head), record.expectedBase)) {
    throw new KnownError('setting-extension-stale', 'setting base changed')
  }
  if (pendingChapter(work)) throw new KnownError('setting-extension-chapter-pending', 'a chapter is pending review')
  const baseline = settingContentSchema.parse(head.content)
  // Construct, rather than accept, the append-only diff. Complete schema validation
  // rechecks global identity uniqueness and all merged limits before any write.
  const merged = settingContentSchema.safeParse({ ...baseline, extensions: [...baseline.extensions, record.extension] })
  if (!merged.success) throw new KnownError('setting-extension-invalid', 'invalid append-only setting extension')
  const artifact = artifactSchema.parse({ id: `artifact-${randomUUID()}`, workId: work.id, kind: 'setting', version: head.version + 1,
    content: merged.data, humanStatus: 'approved', createdAt: updatedAt, inputs: [{ kind: 'setting', ...record.expectedBase }] })
  return { artifact, record: { ...record, status: 'approved', candidate: refOf(artifact), updatedAt } }
}
