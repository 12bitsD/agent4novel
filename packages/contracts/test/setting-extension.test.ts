import { describe, expect, it } from 'vitest'
import {
  settingExtensionDraftSchema,
  settingExtensionProposalRecordSchema,
  settingExtensionProposeRequestSchema,
  settingExtensionResourceSchema,
  settingExtensionReceiptSchema,
  settingLimits,
} from '../src/index.js'

const request = {
  requestId: '11111111-1111-4111-8111-111111111111',
  expectedBase: { artifactId: 'setting-1', version: 3 },
  extension: { title: '补充规则', items: [{ title: '潮汐', content: '潮汐每天改变一次。' }] },
}
const timestamps = { createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z' }
const record = {
  workId: 'w1', requestId: request.requestId, expectedBase: request.expectedBase, request: { ...request, workId: 'w1' },
  extension: { sectionId: 'section-1', title: '补充规则', items: [{ itemId: 'item-1', title: '潮汐', content: '潮汐每天改变一次。' }] },
  status: 'pending' as const, candidate: null, ...timestamps,
}

describe('setting extension contracts', () => {
  it('accepts a strict draft without client identities', () => {
    expect(settingExtensionDraftSchema.parse(request.extension)).toEqual(request.extension)
    expect(settingExtensionProposeRequestSchema.parse(request)).toEqual(request)
  })

  it('trims extension input at the contract boundary without widening limits', () => {
    const parsed = settingExtensionProposeRequestSchema.parse({
      ...request,
      extension: { title: ' 补充规则 ', items: [{ title: ' 潮汐 ', content: ' 潮汐每天改变一次。 ' }] },
    })
    expect(parsed.extension).toEqual({ title: '补充规则', items: [{ title: '潮汐', content: '潮汐每天改变一次。' }] })
    expect(settingExtensionDraftSchema.safeParse({
      title: `${' '.repeat(settingLimits.title)}a`, items: request.extension.items,
    }).success).toBe(false)
  })

  it('enforces proposal record cross-field and status invariants', () => {
    expect(settingExtensionProposalRecordSchema.safeParse(record).success).toBe(true)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, workId: 'other' }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, requestId: '22222222-2222-4222-8222-222222222222' }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, expectedBase: { artifactId: 'other', version: 3 } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, request: { ...record.request, workId: 'other' } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, request: { ...request, requestId: '22222222-2222-4222-8222-222222222222' } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, request: { ...request, expectedBase: { artifactId: 'other', version: 3 } } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, status: 'approved', candidate: null }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, status: 'approved', candidate: { artifactId: 'artifact-2', version: 4 } }).success).toBe(true)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, candidate: { artifactId: 'artifact-2', version: 4 } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, status: 'cancelled', candidate: { artifactId: 'artifact-2', version: 4 } }).success).toBe(false)
  })

  it('requires the persisted extension to match the trimmed request content', () => {
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, extension: { ...record.extension, title: '其他规则' } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, extension: { ...record.extension, items: [{ ...record.extension.items[0], title: '其他条目' }] } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, extension: { ...record.extension, items: [{ ...record.extension.items[0], content: '其他内容' }] } }).success).toBe(false)
    expect(settingExtensionProposalRecordSchema.safeParse({ ...record, extension: { ...record.extension, items: [] } }).success).toBe(false)
  })

  it('rejects identities and unknown fields in the proposal', () => {
    expect(settingExtensionDraftSchema.safeParse({ ...request.extension, sectionId: 'client-id' }).success).toBe(false)
    expect(settingExtensionDraftSchema.safeParse({ ...request.extension, items: [{ ...request.extension.items[0], itemId: 'client-id' }] }).success).toBe(false)
  })

  it('keeps none resources and receipts as strict discriminated shapes', () => {
    const resource = settingExtensionResourceSchema.parse({
      kind: 'setting-extension', workId: 'w1', requestId: request.requestId, status: 'none',
      proposal: null, base: null, extension: null, candidate: null,
      impact: {
        observedAt: new Date().toISOString(), approvedChapterCount: 0, pendingChapterCount: 0,
        continuityWarning: false, historicalArtifactsUnchanged: true,
        futureGeneration: 'uses-after-approval', automaticRewrite: false, existingFactMutation: false,
      }, createdAt: null, updatedAt: null,
    })
    expect(resource.status).toBe('none')
    expect(settingExtensionReceiptSchema.parse({
      requestId: request.requestId, workId: 'w1', operation: 'propose', outcome: 'success',
      writeOutcome: 'committed', proposal: { workId: 'w1', requestId: request.requestId },
      candidate: null, errorCode: null,
    }).proposal?.requestId).toBe(request.requestId)
  })
})
