import { z } from 'zod'
import { captionContentSchema, creativeContentSchema, creativePackSchema, jsonValueSchema } from '@agent4novel/contracts'

// creative 步骤 io(#3c):输入 = seed + upstream.caption(提炼稿);输出 = N 个创意稿。
// directionCount 不进 inputSchema(属 config);生成后由 step 校验数量并注入 directionId。
export const creativeStepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  upstream: z.object({ caption: captionContentSchema }).catchall(jsonValueSchema),
})
export type CreativeStepInput = z.infer<typeof creativeStepInputSchema>

// LLM 面向的输出:directionId 由 server 注入,模型不产
export const creativeLlmOutputSchema = z.object({
  directions: z.array(creativePackSchema.omit({ directionId: true })).min(1).max(3),
})

export const creativeStepOutputSchema = z.object({
  content: creativeContentSchema,
})
export type CreativeStepOutput = z.infer<typeof creativeStepOutputSchema>
