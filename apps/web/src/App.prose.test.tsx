// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from './App.js'

it('reopens the saved first chapter from the work URL without generating again', async () => {
  const oldUrl = window.location.href
  window.history.replaceState(null, '', '?work=return-work')
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/works' ? [] : { id: 'return-work', title: '已保存作品', seed: '种子', config: {}, createdAt: '2026-09-29',
    artifacts: [{ id: 'prose-saved', workId: 'return-work', kind: 'prose', chapter: 1, version: 3, humanStatus: 'approved', createdAt: '2026-09-29', content: { text: '最后保存的正文。' } }],
    workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft'],
  })))
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<App />))
    expect(host.textContent).toContain('最后保存的正文。')
    expect(host.textContent).toContain('第一章已完成')
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/works/return-work')
    await act(async () => root.render(<App key="refresh" />))
    expect(host.textContent).toContain('最后保存的正文。')
    expect(fetchMock.mock.calls).toHaveLength(2)
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, '', oldUrl)
  }
})
