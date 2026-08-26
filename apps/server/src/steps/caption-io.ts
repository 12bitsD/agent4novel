import { z } from 'zod'
import { captionContentSchema, jsonValueSchema } from '@agent4novel/contracts'

// caption 步骤 io(#3c):输入 = 固有 seed + 空 upstream;输出 = 提炼稿
export const captionStepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  upstream: jsonValueSchema,
})
export type CaptionStepInput = z.infer<typeof captionStepInputSchema>

export const captionStepOutputSchema = z.object({
  content: captionContentSchema,
})
export type CaptionStepOutput = z.infer<typeof captionStepOutputSchema>
