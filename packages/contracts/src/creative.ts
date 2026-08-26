import { z } from 'zod'

// creative(创意稿,#3c):creative 步骤产物——一个方向包 = 一份完整的创作方向,全 hint 级。
// N 个方向包(N=directionCount,默认 2,严格 1~3)进比较视图,作者选定其一。
// 领域词见 CONTEXT.md「创意稿」;形状单源同步 docs/schema.md。

const shortText = z.string().trim().min(1).max(100)
const midText = z.string().trim().min(1).max(500)

// 各域 hint schema 分别导出(今日同形 {title, content},刻意不公共化——人物/设定/大纲演进方向不同)
export const characterHintSchema = z
  .object({ title: shortText, content: midText })
  .strict()
export type CharacterHint = z.infer<typeof characterHintSchema>

export const settingHintSchema = z
  .object({ title: shortText, content: midText })
  .strict()
export type SettingHint = z.infer<typeof settingHintSchema>

export const outlineHintSchema = z
  .object({ title: shortText, content: midText })
  .strict()
export type OutlineHint = z.infer<typeof outlineHintSchema>

// 一个方向包。directionId 由 server 在生成落库时注入(形如 `w-3-dir-1`),web 永不生成、编辑不得修改
export const creativePackSchema = z
  .object({
    directionId: z.string().trim().min(1).max(64),
    title: shortText,
    hook: midText,
    tags: z.array(shortText.max(20)).max(8).refine((a) => new Set(a).size === a.length, {
      message: 'tags must be unique',
    }),
    synopsis: z.string().trim().min(1).max(2000),
    characters: z.array(characterHintSchema).max(8),
    setting: z.array(settingHintSchema).max(12),
    payoffs: z.array(shortText.max(120)).max(8),
    outline: z.array(outlineHintSchema).max(12),
  })
  .strict()
export type CreativePack = z.infer<typeof creativePackSchema>

export const creativeContentSchema = z
  .object({
    directions: z.array(creativePackSchema).min(1).max(3),
  })
  .strict()
export type CreativeContent = z.infer<typeof creativeContentSchema>
