import { z } from 'zod'

// caption(提炼稿,#3c):理解素材后的故事开发判断与提案,落库即 approved,不设关卡。
// 领域词见 CONTEXT.md「提炼稿」;形状单源同步 docs/schema.md。
export const inputStages = ['脑洞', '设定', '主线', '模板'] as const
export type InputStage = (typeof inputStages)[number]

const shortText = z.string().trim().min(1).max(200)
const longText = z.string().trim().min(1).max(2000)

// 提炼要素:素材支点或剧情开发提案；来源区分由 prompt 要求，kind 为自由短标签。
export const captionElementSchema = z
  .object({
    kind: shortText.max(20),
    content: z.string().trim().min(1).max(500),
  })
  .strict()
export type CaptionElement = z.infer<typeof captionElementSchema>

export const captionContentSchema = z
  .object({
    inputStage: z.enum(inputStages),
    summary: longText,
    elements: z.array(captionElementSchema).max(20),
    gaps: z.array(z.string().trim().min(1).max(200)).max(10),
  })
  .strict()
export type CaptionContent = z.infer<typeof captionContentSchema>
