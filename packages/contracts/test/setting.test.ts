import { describe, it, expect } from 'vitest'
import { settingContentSchema, settingReviewDraftSchema, settingDraftSchema, settingApproveRequestSchema, settingApproveResponseSchema } from '../src/index.js'

export const setting = {
  overview: '  一座海港里的家庭故事。\n\n**重新出发**。  ',
  world: [{ itemId: 'item-world', title: '  海港  ', content: '  港口按潮汐开门。\n' }],
  characters: [{ itemId: 'item-person', title: '阿澄', content: '修船师，想保住祖父的船。' }],
  factions: [],
  relationships: [],
  extensions: [],
}

describe('完整设定契约', () => {
  it('接受六栏目，规范化标题但保留 Markdown 源文本', () => {
    const parsed = settingContentSchema.parse(setting)
    expect(parsed.world[0]?.title).toBe('海港')
    expect(parsed.world[0]?.content).toBe('  港口按潮汐开门。\n')
    expect(parsed.overview).toBe('  一座海港里的家庭故事。\n\n**重新出发**。  ')
    expect(parsed.extensions).toEqual([])
  })

  it('拒绝不完整栏目、空白内容、空补充栏目和未知字段', () => {
    for (const invalid of [
      { ...setting, overview: ' \n ' },
      { ...setting, world: [] },
      { ...setting, characters: [] },
      { ...setting, factions: null },
      { ...setting, relationships: undefined },
      { ...setting, unknown: true },
      { ...setting, world: [{ itemId: 'i', title: ' ', content: 'x' }] },
      { ...setting, world: [{ itemId: 'i', title: 'x', content: '\n ' }] },
      { ...setting, world: [{ itemId: '', title: 'x', content: 'x' }] },
      { ...setting, extensions: [{ sectionId: 's', title: '航海', items: [] }] },
    ]) expect(settingContentSchema.safeParse(invalid).success).toBe(false)
  })

  it('通过草稿允许新卡省略 ID，模型输出则完全不带 ID', () => {
    const review = { ...setting, factions: [{ title: '船会', content: '共同维护船坞。' }] }
    expect(settingReviewDraftSchema.parse(review).factions[0]).toEqual({ title: '船会', content: '共同维护船坞。' })
    const generated = {
      overview: '港口故事', world: [{ title: '港口', content: '封闭港口。' }],
      characters: [{ title: '船长', content: '寻找归途。' }], factions: [], relationships: [], extensions: [],
    }
    expect(settingDraftSchema.parse(generated)).toEqual(generated)
    expect(settingDraftSchema.safeParse(setting).success).toBe(false)
    expect(settingReviewDraftSchema.safeParse({ ...review, factions: [{ itemId: null, title: '船会', content: 'x' }] }).success).toBe(false)
  })

  it('全设定身份不重复，技术预算超限会拒绝而不截断内容', () => {
    const duplicate = { ...setting, factions: [{ itemId: 'item-world', title: '旧船会', content: '重复身份' }] }
    expect(settingContentSchema.safeParse(duplicate).success).toBe(false)
    expect(settingReviewDraftSchema.safeParse(duplicate).success).toBe(false)
    expect(settingContentSchema.safeParse({ ...setting, extensions: [{ sectionId: 'item-world', title: '航海', items: setting.characters }] }).success).toBe(false)
    for (const invalid of [
      { ...setting, overview: '字'.repeat(20_001) },
      { ...setting, world: [{ itemId: 'i', title: '字'.repeat(257), content: 'x' }] },
      { ...setting, factions: Array.from({ length: 255 }, (_, i) => ({ itemId: `f-${i}`, title: '船会', content: 'x' })) },
      { ...setting, factions: Array.from({ length: 11 }, (_, i) => ({ itemId: `f-${i}`, title: '船会', content: '字'.repeat(20_000) })) },
    ]) expect(settingContentSchema.safeParse(invalid).success).toBe(false)
    expect(settingContentSchema.parse({ ...setting, overview: '字'.repeat(20_000) }).overview.length).toBe(20_000)
  })

  it('通过协议要求明确版本，成功响应必须是无 chapter 的已通过设定', () => {
    expect(settingApproveRequestSchema.parse({ content: setting, expectedHeadVersion: 1 }).expectedHeadVersion).toBe(1)
    for (const expectedHeadVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(settingApproveRequestSchema.safeParse({ content: setting, expectedHeadVersion }).success).toBe(false)
    }
    expect(settingApproveRequestSchema.safeParse({ content: setting, expectedHeadVersion: 1, draft: true }).success).toBe(false)
    const response = { id: 'a1', workId: 'w1', kind: 'setting', version: 1, content: setting, humanStatus: 'approved', createdAt: '2026-09-05T00:00:00.000Z' }
    expect(settingApproveResponseSchema.parse(response).humanStatus).toBe('approved')
    expect(settingApproveResponseSchema.safeParse({ ...response, humanStatus: 'pending' }).success).toBe(false)
    expect(settingApproveResponseSchema.safeParse({ ...response, chapter: 1 }).success).toBe(false)
    expect(settingApproveResponseSchema.safeParse({ ...response, kind: 'outline' }).success).toBe(false)
  })
})
