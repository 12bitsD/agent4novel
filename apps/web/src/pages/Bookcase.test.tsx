// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Bookcase from './Bookcase.js'

it('waits for the bookcase result before declaring that there are no works', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let resolve!: (response: Response) => void
  vi.stubGlobal('fetch', () => new Promise<Response>(done => { resolve = done }))
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<Bookcase onNew={() => {}} onOpen={() => {}} />))
    expect(host.textContent).toContain('正在读取作品')
    expect(host.textContent).not.toContain('暂无作品')
    await act(async () => resolve(new Response(JSON.stringify([]))))
    expect(host.textContent).toContain('暂无作品')
    expect(host.textContent).not.toContain('正在读取作品')
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})


async function mountBookcase(fetchMock: (url: string) => Promise<Response>, strict = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const open = vi.fn(), create = vi.fn()
  const view = <Bookcase onNew={create} onOpen={open} />
  await act(async () => root.render(strict ? <StrictMode>{view}</StrictMode> : view))
  return { host, open, create, async dispose() { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() } }
}
const item = (id: string, title: string, chapterCount: number) => ({ id, title, seedPreview: '真实素材片段', chapterCount })

it('separates a failed read from an empty bookcase and retries only that read', async () => {
  const calls: string[] = []
  const ui = await mountBookcase(async url => {
    calls.push(url)
    return calls.length === 1 ? new Response(JSON.stringify({ code: 'internal-error', message: 'synthetic error', retryable: false }), { status: 500 })
      : new Response(JSON.stringify([item('work-2', '长夜邮局', 2)]))
  })
  try {
    expect(ui.host.querySelector('[role="alert"]')).not.toBeNull()
    expect(ui.host.textContent).not.toContain('暂无作品')
    await act(async () => [...ui.host.querySelectorAll('button')].find(button => button.textContent === '重新读取书架')!.click())
    expect(ui.host.querySelector('[role="alert"]')).toBeNull()
    expect(ui.host.textContent).toContain('长夜邮局')
    expect(ui.host.textContent).toContain('已完成 2 章')
    expect(calls).toEqual(['/api/works', '/api/works'])
    expect(ui.open).not.toHaveBeenCalled(); expect(ui.create).not.toHaveBeenCalled()
  } finally { await ui.dispose() }
})

it.each(['success', 'failure'] as const)('refuses a late %s from an older read lifecycle', async outcome => {
  let oldReply!: (response: Response) => void
  const old = new Promise<Response>(resolve => { oldReply = resolve })
  let reads = 0
  const ui = await mountBookcase(async () => ++reads === 1 ? old : new Response(JSON.stringify([item('new', '新读取的作品', 3)])), true)
  try {
    expect(ui.host.textContent).toContain('新读取的作品')
    await act(async () => oldReply(outcome === 'success' ? new Response(JSON.stringify([item('old', '旧读取的作品', 1)]))
      : new Response(JSON.stringify({ code: 'internal-error', message: 'old failure', retryable: false }), { status: 500 })))
    expect(ui.host.textContent).toContain('新读取的作品')
    expect(ui.host.textContent).not.toContain('旧读取的作品')
    expect(ui.host.querySelector('[role="alert"]')).toBeNull()
  } finally { await act(async () => oldReply(new Response(JSON.stringify([])))); await ui.dispose() }
})

it('keeps the whole work card a native keyboard-focusable action with real title and chapter count', async () => {
  const ui = await mountBookcase(async () => new Response(JSON.stringify([item('work-id', '书名来自服务端', 4)])))
  try {
    const card = ui.host.querySelector<HTMLButtonElement>('.bookcase-card')!
    expect(card.tagName).toBe('BUTTON'); expect(card.tabIndex).toBe(0)
    expect(card.querySelector('.bookcase-title')!.textContent).toBe('书名来自服务端')
    expect(card.textContent).toContain('已完成 4 章')
    card.focus(); expect(document.activeElement).toBe(card)
    await act(async () => card.click())
    expect(ui.open).toHaveBeenCalledExactlyOnceWith('work-id')
    expect(ui.create).not.toHaveBeenCalled()
  } finally { await ui.dispose() }
})

it('does not let an unmounted read populate another bookcase owner', async () => {
  let reply!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { reply = resolve })
  const old = await mountBookcase(async () => pending)
  await old.dispose()
  const fresh = await mountBookcase(async () => new Response(JSON.stringify([item('fresh', '新书架作品', 1)])))
  try {
    await act(async () => reply(new Response(JSON.stringify([item('old', '卸载后的旧作品', 8)]))))
    expect(fresh.host.textContent).toContain('新书架作品')
    expect(fresh.host.textContent).not.toContain('卸载后的旧作品')
    expect(old.open).not.toHaveBeenCalled()
  } finally { await fresh.dispose() }
})
