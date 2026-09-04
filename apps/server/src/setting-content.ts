import { randomUUID } from 'node:crypto'
import { settingCardSections, settingContentSchema, type SettingContent, type SettingReviewDraft } from '@agent4novel/contracts'
import { z } from 'zod'

// 两个创建入口（模型整份生成、作者新增卡片）共用身份分配；只返回新对象。
export function assignSettingIds(draft: SettingReviewDraft, baseline?: SettingContent): SettingContent {
  if (baseline) {
    const itemIds = new Set([
      ...settingCardSections.flatMap((column) => baseline[column]),
      ...baseline.extensions.flatMap((section) => section.items),
    ].map((item) => item.itemId))
    const sectionIds = new Set(baseline.extensions.map((section) => section.sectionId))
    const issues: z.ZodIssue[] = []
    const check = (value: string | undefined, ids: Set<string>, path: (string | number)[]) => {
      if (value !== undefined && !ids.has(value)) issues.push({ code: 'custom', path, message: '身份标识不属于当前设定的同类条目' })
    }
    for (const column of settingCardSections) draft[column].forEach((item, i) => check(item.itemId, itemIds, [column, i, 'itemId']))
    draft.extensions.forEach((section, i) => {
      check(section.sectionId, sectionIds, ['extensions', i, 'sectionId'])
      section.items.forEach((item, j) => check(item.itemId, itemIds, ['extensions', i, 'items', j, 'itemId']))
    })
    if (issues.length) throw new z.ZodError(issues)
  }
  const used = new Set<string>()
  const collect = (content: SettingReviewDraft) => {
    for (const item of [...content.world, ...content.characters, ...content.factions, ...content.relationships, ...content.extensions.flatMap((section) => section.items)]) {
      if (item.itemId) used.add(item.itemId)
    }
    for (const section of content.extensions) if (section.sectionId) used.add(section.sectionId)
  }
  collect(draft)
  if (baseline) collect(baseline)
  const id = (prefix: string) => {
    let value: string
    do { value = `${prefix}-${randomUUID()}` } while (used.has(value))
    used.add(value)
    return value
  }
  const items = (values: SettingReviewDraft['world']) => values.map((item) => ({ ...item, itemId: item.itemId ?? id('item') }))
  return settingContentSchema.parse({
    overview: draft.overview,
    world: items(draft.world), characters: items(draft.characters),
    factions: items(draft.factions), relationships: items(draft.relationships),
    extensions: draft.extensions.map((section) => ({
      ...section, sectionId: section.sectionId ?? id('section'), items: items(section.items),
    })),
  })
}
