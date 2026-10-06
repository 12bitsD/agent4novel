// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import SettingReview from './SettingReview.js'
import { initSettingReview } from '../setting-review.js'

it('focuses an invalid field without smooth movement when reduced motion is requested', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  const scroll = vi.fn(); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  const state = { ...initSettingReview({ id: 'setting-1', workId: 'motion-work', kind: 'setting', version: 1, humanStatus: 'pending', createdAt: '2026-10-06', content: { overview: '设定', world: [{ itemId: 'world-1', title: '世界', content: '规则' }], characters: [{ itemId: 'person-1', title: '主角', content: '动机' }], factions: [], relationships: [], extensions: [] } }), mode: 'edit' as const, focusTarget: 'overview' }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<SettingReview state={state} allowApprove onAction={() => {}} onApprove={() => {}} onConfirm={() => {}} onRetry={() => {}} />))
    expect(document.activeElement).toBe(host.querySelector('[data-setting-field="overview"]'))
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
  }
})
