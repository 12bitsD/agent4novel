// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from './App.js'

const work = { id: 'chapter-work', title: '可重入章节', seed: '脑洞', config: {}, createdAt: '2026-09-29',
  artifacts: [1, 2].map(chapter => ({ id: `prose-${chapter}`, workId: 'chapter-work', kind: 'prose', chapter, version: 1,
    humanStatus: 'approved', createdAt: '2026-09-29', content: { text: `第 ${chapter} 章已保存正文` } })),
  currentChapter: 2, chapters: [1, 2].map(chapter => ({ chapter, title: `章节 ${chapter}`, beatStatus: 'approved', proseStatus: 'approved',
    allowedActions: chapter === 2 ? ['save-draft', 'start-next-chapter'] : ['save-draft'], needsContinuityReview: false })),
  workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft', 'start-next-chapter'] }

it.each(['1', '99'])('restores the addressed chapter %s and keeps subsequent selection reloadable without generation', async input => {
  const oldUrl = window.location.href
  window.history.replaceState(null, '', `?work=chapter-work&chapter=${input}`)
  const calls = vi.fn(async () => new Response(JSON.stringify(work)))
  vi.stubGlobal('fetch', calls); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<App />))
    expect(host.textContent).toContain(input === '1' ? '第 1 章已保存正文' : '第 2 章已保存正文')
    if (input === '99') expect(host.textContent).toContain('尚不存在，已打开当前章节')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-chapter="2"]')!.click())
    expect(new URLSearchParams(window.location.search).get('chapter')).toBe('2')
    await act(async () => root.render(<App key="reload" />))
    expect(host.textContent).toContain('第 2 章已保存正文')
    expect(host.textContent).not.toContain('第 1 章已保存正文')
    expect(calls.mock.calls.every(([url]: unknown[]) => url === '/api/works/chapter-work')).toBe(true)
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, '', oldUrl)
  }
})
