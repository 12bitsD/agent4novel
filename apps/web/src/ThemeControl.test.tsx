// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ThemeControl from './ThemeControl.js'

afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ThemeControl />))
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!
  return { host, root, select, async close() { await act(async () => root.unmount()); host.remove() } }
}

it('follows the system by default and remembers an explicit choice across remounts', async () => {
  let ui = await mount()
  try {
    expect(ui.select.value).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    await act(async () => { ui.select.value = 'dark'; ui.select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.documentElement.dataset.theme).toBe('dark')
    await ui.close(); ui = await mount()
    expect(ui.select.value).toBe('dark')
    await act(async () => { ui.select.value = 'system'; ui.select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  } finally { await ui.close() }
})

it('ignores invalid stored preferences', async () => {
  localStorage.setItem('a4n-theme', 'invalid')
  const ui = await mount()
  try { expect(ui.select.value).toBe('system') } finally { await ui.close() }
})

it('can still change themes when browser preference storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied') })
  const ui = await mount()
  try {
    await act(async () => { ui.select.value = 'light'; ui.select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.documentElement.dataset.theme).toBe('light')
  } finally { await ui.close() }
})
