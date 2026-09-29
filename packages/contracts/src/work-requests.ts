import { z } from 'zod'
import { artifactKinds, perChapterKinds } from './artifact-envelope.js'
import { creativeContentSchema } from './creative.js'
import { outlineDraftSchema } from './outline.js'

export const workCreateRequestSchema = z.object({
  seed: z.string().min(1), title: z.string().optional(),
}).strict()
export type WorkCreateRequest = z.infer<typeof workCreateRequestSchema>

export const workSummarySchema = z.object({
  id: z.string().min(1), title: z.string(), seedPreview: z.string(),
  chapterCount: z.number().int().nonnegative().safe(),
}).strict()
export const workListResponseSchema = z.array(workSummarySchema)

export const creativeDraftRequestSchema = z.object({
  content: creativeContentSchema, expectedHeadVersion: z.number().int().positive().safe(),
}).strict()
export const selectCreativeRequestSchema = z.object({
  directionId: z.string().min(1), expectedHeadVersion: z.number().int().positive().safe(),
}).strict()
export const outlineDraftRequestSchema = z.object({
  content: outlineDraftSchema, expectedHeadVersion: z.number().int().positive().safe(),
}).strict()
export const approveRequestSchema = z.object({
  kind: z.enum(artifactKinds), chapter: z.number().int().positive().safe().optional(),
}).strict().superRefine((value, ctx) => {
  if (perChapterKinds.includes(value.kind) !== (value.chapter !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['chapter'], message: 'chapter 与产物 kind 不匹配' })
  }
})
export type CreativeDraftRequest = z.infer<typeof creativeDraftRequestSchema>
export type SelectCreativeRequest = z.infer<typeof selectCreativeRequestSchema>
export type OutlineDraftRequest = z.infer<typeof outlineDraftRequestSchema>
export type ApproveRequest = z.infer<typeof approveRequestSchema>
