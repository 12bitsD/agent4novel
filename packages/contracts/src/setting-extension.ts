import { z } from 'zod'
import { artifactRefSchema, type ArtifactRef } from './artifact-envelope.js'
import { settingLimits } from './setting.js'

// Validate raw lengths before normalization so trimming cannot widen limits.
const title = z.string().min(1).max(settingLimits.title).refine(value => value.trim().length > 0, '标题不能为空').transform(value => value.trim())
const text = z.string().max(settingLimits.text).refine(value => value.trim().length > 0, '内容不能为空').transform(value => value.trim())
const id = z.string().min(1).max(settingLimits.id).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, '无效的身份标识')
const uuid = z.string().uuid()

export const settingExtensionDraftSchema = z.object({
  title,
  items: z.array(z.object({ title, content: text }).strict()).min(1).max(settingLimits.items),
}).strict()
export type SettingExtensionDraft = z.infer<typeof settingExtensionDraftSchema>

export const settingExtensionProposeRequestSchema = z.object({
  requestId: uuid,
  expectedBase: artifactRefSchema,
  extension: settingExtensionDraftSchema,
}).strict()
export type SettingExtensionProposeRequest = z.infer<typeof settingExtensionProposeRequestSchema>

export const settingExtensionActionRequestSchema = z.object({
  requestId: uuid,
  expectedBase: artifactRefSchema,
}).strict()
export type SettingExtensionActionRequest = z.infer<typeof settingExtensionActionRequestSchema>

export const settingExtensionSchema = z.object({
  sectionId: id,
  title,
  items: z.array(z.object({ itemId: id, title, content: text }).strict()).min(1).max(settingLimits.items),
}).strict()
export type SettingExtension = z.infer<typeof settingExtensionSchema>

export const settingExtensionImpactSchema = z.object({
  observedAt: z.string().datetime({ offset: true }),
  approvedChapterCount: z.number().int().nonnegative().safe(),
  pendingChapterCount: z.number().int().nonnegative().safe(),
  continuityWarning: z.boolean(),
  historicalArtifactsUnchanged: z.literal(true),
  futureGeneration: z.literal('uses-after-approval'),
  automaticRewrite: z.literal(false),
  existingFactMutation: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (value.continuityWarning !== (value.approvedChapterCount > 0)) {
    ctx.addIssue({ code: 'custom', path: ['continuityWarning'], message: 'continuityWarning must reflect approvedChapterCount' })
  }
})
export type SettingExtensionImpact = z.infer<typeof settingExtensionImpactSchema>

export const settingExtensionProposalRefSchema = z.object({ workId: z.string().min(1), requestId: uuid }).strict()
export type SettingExtensionProposalRef = z.infer<typeof settingExtensionProposalRefSchema>

const commonResource = {
  kind: z.literal('setting-extension'),
  workId: z.string().min(1),
  requestId: uuid,
  impact: settingExtensionImpactSchema,
}
const noneResourceSchema = z.object({
  ...commonResource,
  status: z.literal('none'), proposal: z.null(), base: z.null(), extension: z.null(), candidate: z.null(),
  createdAt: z.null(), updatedAt: z.null(),
}).strict()
const existingResourceSchema = z.object({
  ...commonResource,
  status: z.enum(['pending', 'approved', 'cancelled', 'stale']),
  proposal: settingExtensionProposalRefSchema,
  base: artifactRefSchema,
  extension: settingExtensionSchema,
  candidate: artifactRefSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict()
export const settingExtensionResourceSchema = z.union([noneResourceSchema, existingResourceSchema])
export type SettingExtensionResource = z.infer<typeof settingExtensionResourceSchema>

const persistedProposalRequestSchema = settingExtensionProposeRequestSchema.extend({ workId: z.string().min(1) }).strict()

// Durable operation state. `stale` is deliberately a read-time projection and
// is not persisted, so a GET cannot mutate an unapproved proposal.
export const settingExtensionProposalRecordSchema = z.object({
  workId: z.string().min(1), requestId: uuid, expectedBase: artifactRefSchema,
  request: persistedProposalRequestSchema,
  extension: settingExtensionSchema,
  status: z.enum(['pending', 'approved', 'cancelled']),
  candidate: artifactRefSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (value.workId !== value.request.workId) ctx.addIssue({ code: 'custom', path: ['request', 'workId'], message: 'request workId must match record workId' })
  if (value.requestId !== value.request.requestId) ctx.addIssue({ code: 'custom', path: ['request', 'requestId'], message: 'request requestId must match record requestId' })
  if (value.expectedBase.artifactId !== value.request.expectedBase.artifactId || value.expectedBase.version !== value.request.expectedBase.version) {
    ctx.addIssue({ code: 'custom', path: ['request', 'expectedBase'], message: 'request expectedBase must match record expectedBase' })
  }
  if (value.extension.title !== value.request.extension.title) {
    ctx.addIssue({ code: 'custom', path: ['extension', 'title'], message: 'extension title must match request extension title' })
  }
  if (value.extension.items.length !== value.request.extension.items.length) {
    ctx.addIssue({ code: 'custom', path: ['extension', 'items'], message: 'extension items must match request extension items' })
  }
  for (const [index, item] of value.extension.items.entries()) {
    const requested = value.request.extension.items[index]
    if (!requested) continue
    if (item.title !== requested.title) ctx.addIssue({ code: 'custom', path: ['extension', 'items', index, 'title'], message: 'extension item title must match request' })
    if (item.content !== requested.content) ctx.addIssue({ code: 'custom', path: ['extension', 'items', index, 'content'], message: 'extension item content must match request' })
  }
  if (value.status === 'approved' && value.candidate === null) ctx.addIssue({ code: 'custom', path: ['candidate'], message: 'approved record requires candidate' })
  if ((value.status === 'pending' || value.status === 'cancelled') && value.candidate !== null) {
    ctx.addIssue({ code: 'custom', path: ['candidate'], message: 'non-approved record cannot have candidate' })
  }
})
export type SettingExtensionProposalRecord = z.infer<typeof settingExtensionProposalRecordSchema>

export const settingExtensionErrorCodes = [
  'invalid-input', 'work-not-found', 'setting-extension-not-found',
  'setting-extension-base-conflict', 'setting-extension-request-conflict',
  'setting-extension-stale', 'setting-extension-chapter-pending',
  'setting-extension-state-conflict', 'setting-extension-limit',
  'setting-extension-invalid', 'internal-error',
] as const
export const settingExtensionErrorCodeSchema = z.enum(settingExtensionErrorCodes)
export type SettingExtensionErrorCode = z.infer<typeof settingExtensionErrorCodeSchema>

export const settingExtensionReceiptSchema = z.object({
  requestId: uuid,
  workId: z.string().min(1),
  operation: z.enum(['propose', 'approve', 'cancel']),
  outcome: z.enum(['success', 'failed', 'unknown']),
  writeOutcome: z.enum(['committed', 'not-committed', 'unknown']),
  proposal: settingExtensionProposalRefSchema.nullable(),
  candidate: artifactRefSchema.nullable(),
  errorCode: settingExtensionErrorCodeSchema.nullable(),
}).strict()
export type SettingExtensionReceipt = z.infer<typeof settingExtensionReceiptSchema>

export type SettingExtensionBase = ArtifactRef
