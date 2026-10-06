// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createHash, webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import ProseReview from './ProseReview.js'
import { initProseReview } from '../prose-review.js'

const baseline = { id: 'artifact-source', workId: 'work-test', kind: 'prose' as const, chapter: 1, version: 2, humanStatus: 'approved' as const, createdAt: '2026-09-30T00:00:00Z', content: { text: '先😀后重复重复' } }
function button(host: HTMLElement, text: string) { return Array.from(host.querySelectorAll('button')).find(b => b.textContent === text) }
async function mount(fetchMock: ReturnType<typeof vi.fn>, dirty = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const state = { ...initProseReview(baseline), mode: 'edit' as const, ...(dirty ? { draft: { text: baseline.content.text + '未保存' } } : {}) }
  const props = { title: '合成正文', state, allowCommands: true, onAction: () => {}, onApprove: () => {}, onRegenerate: () => {}, onConfirm: () => {}, onRetry: () => {} }
  await act(async () => root.render(<ProseReview {...props} />))
  const select = async () => { const textarea = host.querySelector<HTMLTextAreaElement>('#prose-text')!; await act(async () => { textarea.setSelectionRange(1, 3); textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) }) }
  return { host, select, close: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() } }
}
describe('collecting bad examples directly from saved prose', () => {
  it('binds the native Unicode selection, optional note, and matching saved snapshot', async () => {
    const calls: Record<string, unknown>[] = []
    const f = await mount(vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { const request = JSON.parse(String(init.body)); calls.push(request); const { requestId, ...fields } = request; return new Response(JSON.stringify({ id: requestId, workId: baseline.workId, ...fields, createdAt: '2026-09-30T01:00:00Z' })) }
      return new Response(JSON.stringify({ workId: baseline.workId, chapter: 1, items: [] }))
    }))
    try {
      await f.select()
      expect(button(f.host, '标记为坏例')).toBeDefined()
      await act(async () => { button(f.host, '标记为坏例')!.click(); await vi.waitFor(() => expect(calls).toHaveLength(1)) })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ chapter: 1, sourceArtifactId: baseline.id, sourceVersion: 2, sourceHash: createHash('sha256').update(baseline.content.text).digest('hex'), start: 1, end: 3, text: '😀', note: '' })
      expect(f.host.textContent).toContain('正文 v2'); expect(f.host.textContent).toContain('已保存坏例')
    } finally { await f.close() }
  })
  it('does not submit selections from unsaved prose', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ workId: baseline.workId, chapter: 1, items: [] })))
    const f = await mount(fetchMock, true)
    try { await f.select(); expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false); expect(button(f.host, '标记为坏例')?.disabled ?? true).toBe(true) }
    finally { await f.close() }
  })
  it('keeps earlier unknown immutable on a later rejected retry and confirms only the matching record', async () => {
    const posts: Record<string, unknown>[] = []; let receipt: Record<string, unknown> | undefined
    const f = await mount(vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const request = JSON.parse(String(init.body)); posts.push(request)
        if (posts.length === 1) { const { requestId, ...fields } = request; receipt = { id: requestId, workId: baseline.workId, ...fields, createdAt: '2026-09-30T01:00:00Z' }; throw new Error('lost receipt') }
        return new Response(JSON.stringify({ code: 'version-conflict', message: 'later reject', retryable: false }), { status: 409 })
      }
      if (!url.includes('?')) return new Response(JSON.stringify(receipt))
      return new Response(JSON.stringify({ workId: baseline.workId, chapter: 1, items: [] }))
    }))
    try {
      await f.select(); await act(async () => { button(f.host, '标记为坏例')!.click(); await vi.waitFor(() => expect(posts).toHaveLength(1)) })
      expect(posts).toHaveLength(1); expect(button(f.host, '重试标记原请求')).toBeDefined()
      await act(async () => button(f.host, '重试标记原请求')!.click())
      expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]); expect(button(f.host, '重试标记原请求')).toBeDefined()
      await act(async () => button(f.host, '核对标记结果')!.click())
      expect(f.host.textContent).toContain('已保存坏例'); expect(posts).toHaveLength(2)
    } finally { await f.close() }
  })
})
