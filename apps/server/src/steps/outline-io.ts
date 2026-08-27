import { z } from 'zod'
import {
  creativeContentSchema,
  jsonValueSchema,
  outlineArcSchema,
  outlineContentSchema,
  outlineSegmentSchema,
} from '@agent4novel/contracts'

// outline 步骤 io(#4):输入 = seed + upstream.creative(选定单方向创意稿);输出 = 弧线+剧情点两层大纲。
export const outlineStepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  upstream: z.object({ creative: creativeContentSchema }).catchall(jsonValueSchema),
})
export type OutlineStepInput = z.infer<typeof outlineStepInputSchema>

// LLM 面向的输出:arcId/segmentId 由 server 注入,模型不产
export const outlineLlmOutputSchema = z.object({
  arcs: z
    .array(
      outlineArcSchema.omit({ arcId: true, segments: true }).extend({
        segments: z.array(outlineSegmentSchema.omit({ segmentId: true })).min(2).max(8),
      }),
    )
    .min(3)
    .max(8),
})

export const outlineStepOutputSchema = z.object({
  content: outlineContentSchema,
})
export type OutlineStepOutput = z.infer<typeof outlineStepOutputSchema>
