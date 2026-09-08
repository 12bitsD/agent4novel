import { z } from 'zod'
import { artifactEnvelopeSchema } from './artifacts.js'

export const beatLimits = {
  title: 256, id: 96, text: 20_000, totalText: 100_000, items: 128,
  instructions: 10_000, bodyBytes: 1024 * 1024, maxPromptChars: 400_000,
} as const
const id = z.string().min(1).max(beatLimits.id).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
function fields(complete: boolean) {
  return {
    title: z.string().trim().max(beatLimits.title).min(complete ? 1 : 0),
    content: z.string().max(beatLimits.text).refine(s => !complete || s.trim().length > 0, '内容不能为空'),
  }
}
function beatObject<I extends z.AnyZodObject>(item: I, complete: boolean) {
  const text = fields(complete)
  // Gate the collection before walking item schemas; the pipe validates every allowed item.
  const cards = z.custom<z.input<I>[]>(value => Array.isArray(value) && value.length <= beatLimits.items, '写作安排必须是有界数组')
    .pipe(z.array(item).min(complete ? 1 : 0).max(beatLimits.items))
  return z.object({
    title: text.title, goal: text.content,
    writingPlan: cards, ending: text.content,
  }).strict()
}
const contentObject = beatObject(z.object({ itemId: id, ...fields(true) }).strict(), true)
const reviewObject = beatObject(z.object({ itemId: id.optional(), ...fields(true) }).strict(), true)
const editObject = beatObject(z.object({ itemId: id.optional(), ...fields(false) }).strict(), false)
const draftObject = beatObject(z.object(fields(true)).strict(), true)
function validateWhole(value: z.infer<typeof editObject>, ctx: z.RefinementCtx) {
  const ids = new Set<string>()
  let chars = value.title.length + value.goal.length + value.ending.length
  for (const [i, item] of value.writingPlan.entries()) {
    chars += item.title.length + item.content.length
    if (item.itemId !== undefined) {
      if (ids.has(item.itemId)) ctx.addIssue({ code: 'custom', path: ['writingPlan', i, 'itemId'], message: '身份标识重复' })
      ids.add(item.itemId)
    }
  }
  if (chars > beatLimits.totalText) ctx.addIssue({ code: 'custom', path: [], message: '章纲文本总量超限' })
}
export const beatContentSchema = contentObject.superRefine(validateWhole)
export const beatDraftSchema = draftObject.superRefine(validateWhole)
export const beatEditDraftSchema = editObject.superRefine(validateWhole)
export const beatReviewDraftSchema = reviewObject.superRefine(validateWhole)
export type BeatContent = z.infer<typeof beatContentSchema>
export type BeatDraft = z.infer<typeof beatDraftSchema>
export type BeatEditDraft = z.infer<typeof beatEditDraftSchema>
export type BeatReviewDraft = z.infer<typeof beatReviewDraftSchema>
export const beatArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('beat'), chapter: z.literal(1), content: beatContentSchema,
}).strict()
export type BeatArtifact = z.infer<typeof beatArtifactSchema>
export const beatRequestHeadSchema = z.object({
  chapter: z.literal(1), expectedArtifactId: z.string().min(1).max(128), expectedHeadVersion: z.number().int().positive().safe(),
}).strict()
export const beatApproveRequestSchema = beatRequestHeadSchema.extend({ content: beatReviewDraftSchema }).strict()
export const beatRegenerateRequestSchema = beatRequestHeadSchema.extend({ content: beatEditDraftSchema, instructions: z.string().max(beatLimits.instructions) }).strict()
export type BeatApproveRequest = z.infer<typeof beatApproveRequestSchema>
export type BeatRegenerateRequest = z.infer<typeof beatRegenerateRequestSchema>
