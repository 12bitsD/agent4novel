import {
  settingApproveRequestSchema, settingApproveResponseSchema, settingArtifactSchema,
  settingCardSections, type SettingApproveRequest, type SettingArtifact, type SettingItem,
  type SettingReviewDraft,
} from './setting.js'

// 只确认本次提交的目标已达成，不声称哪个 HTTP 请求赢得了写入。
export function matchesSettingSubmission(
  baseline: SettingArtifact,
  submitted: SettingApproveRequest,
  candidate: unknown,
): boolean {
  const base = settingArtifactSchema.safeParse(baseline)
  const request = settingApproveRequestSchema.safeParse(submitted)
  const response = settingApproveResponseSchema.safeParse(candidate)
  if (!base.success || !request.success || !response.success) return false
  const original = base.data
  const actual = response.data
  if (original.humanStatus !== 'pending' || actual.workId !== original.workId ||
    actual.id !== original.id || actual.version !== original.version ||
    request.data.expectedHeadVersion !== original.version || actual.createdAt !== original.createdAt) return false
  const expected = request.data.content
  const content = actual.content
  const itemIds = new Set<string>()
  const sectionIds = new Set<string>()
  for (const section of settingCardSections) for (const item of original.content[section]) itemIds.add(item.itemId)
  for (const section of original.content.extensions) {
    sectionIds.add(section.sectionId)
    for (const item of section.items) itemIds.add(item.itemId)
  }
  const originalIds = new Set([...itemIds, ...sectionIds])
  const matchId = (requested: string | undefined, stored: string, allowed: Set<string>) =>
    requested === undefined ? !originalIds.has(stored) : allowed.has(requested) && requested === stored
  const matchItems = (draft: SettingReviewDraft['world'], result: SettingItem[]) =>
    draft.length === result.length && draft.every((item, i) => {
      const found = result[i]!
      return item.title === found.title && item.content === found.content && matchId(item.itemId, found.itemId, itemIds)
    })
  return expected.overview === content.overview &&
    settingCardSections.every((section) => matchItems(expected[section], content[section])) &&
    expected.extensions.length === content.extensions.length &&
    expected.extensions.every((section, i) => {
      const found = content.extensions[i]!
      return section.title === found.title && matchId(section.sectionId, found.sectionId, sectionIds) && matchItems(section.items, found.items)
    })
}
