// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import BeatReview from './BeatReview.js'
import { initBeatReview, reduceBeatReview } from '../beat-review.js'
import type { BeatArtifact } from '@agent4novel/contracts'

const artifact: BeatArtifact = { id: 'artifact-test', workId: 'work-test', kind: 'beat', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-08',
  content: { title: '第一章', goal: '**目标**', writingPlan: [{ itemId: 'beat-item-old', title: '安排', content: '- 线索\n- 选择' }], ending: '> 落点' },
}
describe('mounted Beat review', () => {
  it('shows finite Markdown and requires author confirmation for whole regeneration, defaulting to cancel', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const regenerate = vi.fn()
    function Harness() {
      const [state, dispatch] = useReducer(reduceBeatReview, artifact, initBeatReview)
      return <BeatReview state={state} onAction={dispatch} allowCommands onApprove={() => {}} onRegenerate={regenerate} onConfirm={() => {}} onRetry={() => {}} />
    }
    try {
      await act(async () => root.render(<Harness />))
      expect(host.querySelector('strong')?.textContent).toBe('目标')
      expect(host.querySelectorAll('li')).toHaveLength(2)
      const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '重新生成整份章纲')!
      button.focus()
      await act(async () => button.click())
      expect(host.querySelector('[role="dialog"]')).not.toBeNull()
      expect(document.activeElement?.textContent).toBe('继续编辑')
      const dialogButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      dialogButtons.at(-1)!.focus()
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
      expect(document.activeElement).toBe(dialogButtons[0])
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
      expect(document.activeElement).toBe(dialogButtons.at(-1))
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(host.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(button)
      expect(regenerate).not.toHaveBeenCalled()
      await act(async () => button.click())
      await act(async () => (host.querySelector('.setting-modal-backdrop') as HTMLElement).click())
      expect(host.querySelector('[role="dialog"]')).toBeNull()
      expect(regenerate).not.toHaveBeenCalled()
      await act(async () => button.click())
      const confirm = Array.from(host.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === '确认重新生成') as HTMLButtonElement
      await act(async () => confirm.click())
      expect(regenerate).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})
