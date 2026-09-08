import { describe, expect, it } from 'vitest'
import { beatContentSchema, beatDraftSchema, beatEditDraftSchema, beatReviewDraftSchema } from '../src/beat.js'

const draft = { title: ' 第一章 ', goal: ' **目标**\n', writingPlan: [{ title: '遭遇', content: '发生转折。' }], ending: '> 悬念' }
describe('Beat public content contract', () => {
  it('rejects oversized card arrays before validating every item', () => {
    const result = beatEditDraftSchema.safeParse({ ...draft, writingPlan: Array.from({ length: 10_000 }, () => ({})) })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toHaveLength(1)
  })
  it('keeps Markdown and requires a complete ordered plan, except an unfinished regeneration draft', () => {
    expect(beatDraftSchema.parse(draft)).toEqual({ ...draft, title: '第一章' })
    expect(beatContentSchema.safeParse(draft).success).toBe(false)
    expect(beatReviewDraftSchema.safeParse(draft).success).toBe(true)
    const incomplete = { title: '', goal: '', writingPlan: [], ending: '' }
    expect(beatEditDraftSchema.safeParse(incomplete).success).toBe(true)
    expect(beatReviewDraftSchema.safeParse(incomplete).success).toBe(false)
    expect(beatDraftSchema.safeParse({ ...draft, prose: 'unwanted' }).success).toBe(false)
    expect(beatDraftSchema.safeParse({ ...draft, goal: ' '.repeat(20_001) }).success).toBe(false)
    expect(beatDraftSchema.safeParse({ ...draft, ending: undefined }).success).toBe(false)
    expect(beatContentSchema.safeParse({ ...draft, writingPlan: [
      { itemId: 'beat-item-1', title: '一', content: '一' }, { itemId: 'beat-item-1', title: '二', content: '二' },
    ] }).success).toBe(false)
  })
})
