// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { reduceBeatReview, initBeatReview } from '../beat-review.js'

const original = { id: 'beat-a', workId: 'work-test', kind: 'beat' as const, chapter: 1, version: 1, humanStatus: 'pending' as const, createdAt: '2026-10-10', content: { title: '旧章纲', goal: '旧目标', writingPlan: [{ itemId: 'item-old', title: '旧安排', content: '旧内容' }], ending: '旧落点' } }
const candidate = { ...original, id: 'beat-b', version: 2, content: { ...original.content, title: '新章纲', goal: '新目标' } }

describe('E20 Web acceptance: compare/select beat variants', () => {
  it('enters a compare phase with frozen A/B and does not approve before an explicit choice', () => {
    const state = initBeatReview(original)
    const compared = reduceBeatReview(state, { type: 'variant-result', original, candidate } as never)
    expect(compared.phase).toBe('comparing')
    expect(compared.comparison).toMatchObject({ original, candidate })
    expect(compared.phase).not.toBe('approved')
  })

  it('keeps the frozen comparison material on an unknown selection result', () => {
    const state = reduceBeatReview(initBeatReview(original), { type: 'variant-result', original, candidate } as never)
    const unknown = reduceBeatReview(state, { type: 'variant-unknown' } as never)
    expect(unknown.phase).toBe('uncertain')
    expect(unknown.comparison).toMatchObject({ original, candidate })
    expect(unknown.submitted).toBeDefined()
  })
})
