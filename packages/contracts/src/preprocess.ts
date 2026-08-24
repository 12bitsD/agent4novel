import { z } from 'zod'

// provisional: #3a 的简单版形状（单实例四字段）。
// #3b 对齐后可能变（多实例候选 / 新字段），届时只改这一处。
export const preprocessContentSchema = z.object({
  hook: z.string(),
  synopsis: z.string(),
  setting: z.string(),
  outline: z.string(),
})
export type PreprocessContent = z.infer<typeof preprocessContentSchema>
