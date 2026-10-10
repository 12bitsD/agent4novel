import { z } from 'zod'
import { artifactEnvelopeSchema, chapterRegenerationBindingSchema } from './artifact-envelope.js'

export const proseLimits = { text: 100_000, instructions: 10_000, bodyBytes: 1024 * 1024, maxPromptChars: 400_000 } as const
const text = z.string().max(proseLimits.text)
export const proseEditDraftSchema = z.object({ text }).strict()
// Whitespace is author content: check completeness without transforming the saved value.
export const proseContentSchema = z.object({ text: text.refine(value => value.trim().length > 0, '正文不能为空') }).strict()
export type ProseContent = z.infer<typeof proseContentSchema>
export type ProseEditDraft = z.infer<typeof proseEditDraftSchema>
export const proseArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('prose'), chapter: z.number().int().positive().safe(), content: proseEditDraftSchema,
}).strict().superRefine((artifact, ctx) => {
  if (artifact.humanStatus === 'approved' && !artifact.content.text.trim()) {
    ctx.addIssue({ code: 'custom', path: ['content', 'text'], message: '已通过正文不能为空' })
  }
})
export type ProseArtifact = z.infer<typeof proseArtifactSchema>
export const proseRequestHeadSchema = z.object({
  chapter: z.number().int().positive().safe(), expectedArtifactId: z.string().min(1).max(128), expectedHeadVersion: z.number().int().positive().safe(),
}).strict()
export const proseApproveRequestSchema = proseRequestHeadSchema.extend({ content: proseContentSchema }).strict()
export const proseRegenerateRequestSchema = proseRequestHeadSchema.extend({ content: proseEditDraftSchema, instructions: z.string().max(proseLimits.instructions), regeneration: chapterRegenerationBindingSchema.optional() }).strict().superRefine((request, ctx) => {
  if (request.regeneration && (request.expectedArtifactId !== request.regeneration.expectedProse.artifactId || request.expectedHeadVersion !== request.regeneration.expectedProse.version)) {
    ctx.addIssue({ code: 'custom', path: ['regeneration'], message: '正文重生绑定必须匹配请求基线' })
  }
})
export const proseSaveRequestSchema = proseRequestHeadSchema.extend({
  expectedHumanStatus: z.enum(['pending', 'approved']), content: proseEditDraftSchema,
}).strict().superRefine((request, ctx) => {
  if (request.expectedHumanStatus === 'approved' && !request.content.text.trim()) {
    ctx.addIssue({ code: 'custom', path: ['content', 'text'], message: '已通过正文不能为空' })
  }
})
export type ProseApproveRequest = z.infer<typeof proseApproveRequestSchema>
export type ProseRegenerateRequest = z.infer<typeof proseRegenerateRequestSchema>
export type ProseSaveRequest = z.infer<typeof proseSaveRequestSchema>
