// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from './App.js'

it('keeps the current entry draft and never generates when the theme changes', async () => {
  const oldUrl = window.location.href
  window.history.replaceState(null, '', '?view=entry')
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ demo: true, provider: 'demo', model: 'fake', directionCount: 2 })))
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<App />))
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '尚未提交的脑洞'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const theme = host.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!
    await act(async () => { theme.value = 'dark'; theme.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('尚未提交的脑洞')
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config')
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); localStorage.clear()
    document.documentElement.removeAttribute('data-theme'); window.history.replaceState(null, '', oldUrl)
  }
})
