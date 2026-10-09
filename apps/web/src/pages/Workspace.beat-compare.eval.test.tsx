// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import BeatReview from './BeatReview.js'
import { initBeatReview, type BeatReviewState } from '../beat-review.js'

const original = { id: 'beat-a', workId: 'work-test', kind: 'beat' as const, chapter: 1, version: 1, humanStatus: 'pending' as const, createdAt: '2026-10-10', content: { title: '旧章纲', goal: '旧目标', writingPlan: [{ itemId: 'item-old', title: '旧安排', content: '旧内容' }], ending: '旧落点' } }
const candidate = { ...original, id: 'beat-b', version: 2, content: { ...original.content, title: '新章纲', goal: '新目标' } }

describe('E20 Web acceptance: compare/select beat variants', () => {
  it('renders both frozen variants, disables approval, and emits only an explicit choice', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('crypto', { randomUUID: () => 'local-key' })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const choices: string[] = []; const actions: string[] = []; const state = { ...initBeatReview(original), phase: 'comparing', mode: 'preview',
      comparison: { original, candidate } } as BeatReviewState
    try {
      await act(async () => root.render(<BeatReview state={state} allowCommands onAction={() => {}} onApprove={vi.fn()} onRegenerate={vi.fn()} onConfirm={vi.fn()} onRetry={vi.fn()}
        onChooseVariant={(choice: 'new' | 'original') => choices.push(choice)} />))
      expect(host.textContent).toContain('旧章纲'); expect(host.textContent).toContain('新章纲')
      expect(host.textContent).toContain('采用新章纲'); expect(host.textContent).toContain('保留旧章纲')
      expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('通过章纲'))?.disabled ?? true).toBe(true)
      expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === '采用新章纲')).toBeDefined()
      await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === '采用新章纲')!.click() })
      expect(choices).toEqual(['new'])
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })

  it('keeps frozen A/B visible and locks approval after an unknown selection result', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', { randomUUID: () => 'local-key' })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const actions: string[] = []; const onAction = vi.fn((action: { type: string }) => actions.push(action.type)); const onConfirm = vi.fn(); const onRetry = vi.fn()
    const state = { ...initBeatReview(original), phase: 'uncertain', mode: 'preview', hasUnknownWrite: true,
      comparison: { original, candidate }, notice: '选择结果尚未确认', recovery: { resolution: 'uncertain', nextActions: ['read-work', 'retry-frozen-request'], hasUnknownWrite: true } } as BeatReviewState
    try {
      await act(async () => root.render(<BeatReview state={state} allowCommands onAction={onAction} onApprove={vi.fn()} onRegenerate={vi.fn()} onConfirm={onConfirm} onRetry={onRetry}
        onChooseVariant={vi.fn()} />))
      expect(host.textContent).toContain('旧章纲'); expect(host.textContent).toContain('新章纲'); expect(host.textContent).toContain('选择结果尚未确认')
      expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('采用新章纲'))).toBe(false)
      expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('通过章纲'))?.disabled ?? true).toBe(true)
      await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === '核对服务器结果')!.click() })
      expect(actions).toEqual([])
      expect(onConfirm).toHaveBeenCalledTimes(1)
      await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重试同一份请求')!.click() })
      expect(onRetry).toHaveBeenCalledTimes(1)
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
})
