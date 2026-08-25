import { z } from 'zod'

// 大纲完整版形态定案（#3b 只定设计，生成实现见 #4）：分章无卷；场景/冲突/钩子归 beat（章纲）层。
export const outlineContentSchema = z.object({
  chapters: z.array(z.object({ number: z.number(), title: z.string(), summary: z.string() })),
})
export type OutlineContent = z.infer<typeof outlineContentSchema>
