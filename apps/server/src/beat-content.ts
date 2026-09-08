import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { beatContentSchema, type BeatContent, type BeatEditDraft, type BeatReviewDraft } from '@agent4novel/contracts'

export function assertBeatIds(draft: BeatEditDraft, baseline: BeatContent): void {
  const allowed = new Set(baseline.writingPlan.map(item => item.itemId))
  const seen = new Set<string>()
  const issues: z.ZodIssue[] = []
  draft.writingPlan.forEach((item, i) => {
    if (item.itemId === undefined) return
    if (!allowed.has(item.itemId) || seen.has(item.itemId)) issues.push({ code: 'custom', path: ['writingPlan', i, 'itemId'], message: '无效的卡片身份' })
    seen.add(item.itemId)
  })
  if (issues.length) throw new z.ZodError(issues)
}
export function assignBeatIds(draft: BeatReviewDraft, baseline?: BeatContent): BeatContent {
  assertBeatIds(draft, baseline ?? { title: '', goal: '', writingPlan: [], ending: '' })
  const used = new Set(baseline?.writingPlan.map(item => item.itemId) ?? [])
  return beatContentSchema.parse({ ...draft, writingPlan: draft.writingPlan.map(item => {
    let itemId = item.itemId
    if (!itemId) {
      do { itemId = `beat-item-${randomUUID()}` } while (used.has(itemId))
      used.add(itemId)
    }
    return { ...item, itemId }
  }) })
}
