import { z } from 'zod'
import { artifactEnvelopeSchema } from './artifacts.js'

export const settingLimits = {
  title: 256, id: 96, text: 20_000, totalText: 200_000, items: 256, sections: 32,
  bodyBytes: 2 * 1024 * 1024,
} as const
export const settingCardSections = ['world', 'characters', 'factions', 'relationships'] as const
const titleSchema = z.string().trim().min(1).max(settingLimits.title)
const textSchema = z.string().max(settingLimits.text).refine((value) => value.trim().length > 0, '内容不能为空')
const idSchema = z.string().min(1).max(settingLimits.id).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, '无效的身份标识')
const itemFields = { title: titleSchema, content: textSchema }
const itemSchema = z.object({ itemId: idSchema, ...itemFields }).strict()
const reviewItemSchema = z.object({ itemId: idSchema.optional(), ...itemFields }).strict()
const draftItemSchema = z.object(itemFields).strict()

function settingObject<I extends z.AnyZodObject, S extends z.AnyZodObject>(item: I, section: S) {
  return z.object({
    overview: textSchema,
    world: z.array(item).min(1).max(settingLimits.items),
    characters: z.array(item).min(1).max(settingLimits.items),
    factions: z.array(item).max(settingLimits.items),
    relationships: z.array(item).max(settingLimits.items),
    extensions: z.array(section).max(settingLimits.sections),
  }).strict()
}

const sectionSchema = z.object({ sectionId: idSchema, title: titleSchema, items: z.array(itemSchema).min(1).max(settingLimits.items) }).strict()
const contentObject = settingObject(itemSchema, sectionSchema)
const reviewObject = settingObject(reviewItemSchema, z.object({
  sectionId: idSchema.optional(), title: titleSchema, items: z.array(reviewItemSchema).min(1).max(settingLimits.items),
}).strict())
const draftObject = settingObject(draftItemSchema, z.object({
  title: titleSchema, items: z.array(draftItemSchema).min(1).max(settingLimits.items),
}).strict())

// 三种边界共用完整性、全局身份和总量规则；模型没有 ID，但仍受同一内容预算保护。
function validateWholeSetting(value: z.infer<typeof reviewObject>, ctx: z.RefinementCtx) {
  const ids = new Set<string>()
  let count = 0
  let chars = value.overview.length
  const id = (value: string | undefined, path: (string | number)[]) => {
    if (value === undefined) return
    if (ids.has(value)) ctx.addIssue({ code: 'custom', path, message: '身份标识重复' })
    ids.add(value)
  }
  const items = (values: z.infer<typeof reviewItemSchema>[], path: (string | number)[]) => {
    for (const [i, item] of values.entries()) {
      count++
      chars += item.title.length + item.content.length
      id(item.itemId, [...path, i, 'itemId'])
    }
  }
  for (const section of settingCardSections) items(value[section], [section])
  for (const [i, section] of value.extensions.entries()) {
    chars += section.title.length
    id(section.sectionId, ['extensions', i, 'sectionId'])
    items(section.items, ['extensions', i, 'items'])
  }
  if (count > settingLimits.items) ctx.addIssue({ code: 'custom', path: [], message: `设定卡片总数不能超过 ${settingLimits.items}` })
  if (chars > settingLimits.totalText) ctx.addIssue({ code: 'custom', path: [], message: `设定文本总量不能超过 ${settingLimits.totalText} 字符` })
}

export const settingContentSchema = contentObject.superRefine(validateWholeSetting)
export const settingReviewDraftSchema = reviewObject.superRefine(validateWholeSetting)
export const settingDraftSchema = draftObject.superRefine(validateWholeSetting)

export type SettingItem = z.infer<typeof itemSchema>
export type ExtensionSection = z.infer<typeof sectionSchema>
export type SettingContent = z.infer<typeof settingContentSchema>
export type SettingReviewDraft = z.infer<typeof settingReviewDraftSchema>
export type SettingDraft = z.infer<typeof settingDraftSchema>

export const settingApproveRequestSchema = z.object({
  content: settingReviewDraftSchema,
  expectedHeadVersion: z.number().int().positive().safe(),
}).strict()

// undefined 在内存对象中可存在，JSON 会省略；任何 chapter 值均非法。
export const settingArtifactSchema = artifactEnvelopeSchema.extend({
  kind: z.literal('setting'), chapter: z.undefined().optional(), content: settingContentSchema,
}).strict()
export const settingApproveResponseSchema = settingArtifactSchema.extend({ humanStatus: z.literal('approved') })
export type SettingApproveRequest = z.infer<typeof settingApproveRequestSchema>
export type SettingArtifact = z.infer<typeof settingArtifactSchema>
export type SettingApproveResponse = z.infer<typeof settingApproveResponseSchema>
