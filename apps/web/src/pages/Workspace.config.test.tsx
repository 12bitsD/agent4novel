// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { authorStepIds, type AuthorConfigView } from '@agent4novel/contracts'
import Workspace from './Workspace.js'

const config = (): AuthorConfigView => ({ workId: 'work-test', revision: 0, document: { preferences: {}, defaults: {}, steps: {} }, files: [],
  effective: authorStepIds.map(id => ({ id, model: 'deepseek:deepseek-chat', provider: 'deepseek', configured: false, executionMode: 'demo', generation: {},
    appliedPreferences: {}, systemPrompt: null, skills: [], tools: [], directionCount: 2 })) })
const work = { id: 'work-test', title: 'test work', seed: 'source', config: {}, createdAt: '2026-09-30', artifacts: [], workflowState: 'ready-to-generate', nextStepId: 'caption', allowedActions: ['generate'] }
function button(host: HTMLElement, text: string) { return Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)! }

describe('configuration in the creative workspace', () => {
  it('keeps configuration drafts and the navigation guard when collapsed and reopened', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/agent-config') ? config() : work)))
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const back = vi.fn()
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={back} />))
      const toggle = button(host, 'Agent 配置')
      await act(async () => toggle.click())
      const input = host.querySelector<HTMLInputElement>('input[aria-label="文风"]')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '保留草稿'); input.dispatchEvent(new Event('input', { bubbles: true })) })
      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(input.closest('[hidden]')).not.toBeNull()
      await act(async () => toggle.click())
      expect(host.querySelector<HTMLInputElement>('input[aria-label="文风"]')!.value).toBe('保留草稿')
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/agent-config'))).toHaveLength(1)
      await act(async () => button(host, '← 返回书架').click())
      expect(host.textContent).toContain('离开当前创作页面？')
      expect(back).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('retains the frozen write when its successful receipt is followed by a failed readback', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let saved = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-config')) {
        if (init?.method === 'PUT') {
          saved = true; const request = JSON.parse(String(init.body))
          return new Response(JSON.stringify({ workId: 'work-test', revision: 1, requestId: request.requestId, document: request.document }))
        }
        if (saved) return new Response(JSON.stringify({ code: 'work-not-found', message: 'read unavailable', retryable: false }), { status: 404 })
        return new Response(JSON.stringify(config()))
      }
      return new Response(JSON.stringify(work))
    }))
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      await act(async () => button(host, 'Agent 配置').click())
      await act(async () => button(host, '保存配置').click())
      expect(host.textContent).toContain('重试原请求')
      expect(host.querySelector<HTMLInputElement>('input[aria-label="文风"]')!.matches(':disabled')).toBe(true)
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('loads only after opening, saves three preferences, and never generates or changes work content', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let view = config()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-config')) {
        if (init?.method === 'PUT') {
          const request = JSON.parse(String(init.body)); view = { ...view, revision: 1, document: request.document }
          return new Response(JSON.stringify({ workId: 'work-test', revision: 1, requestId: request.requestId, document: request.document }))
        }
        return new Response(JSON.stringify(view))
      }
      return new Response(JSON.stringify(work))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/agent-config'))).toBe(false)
      expect(button(host, 'Agent 配置')).toBeDefined()
      await act(async () => button(host, 'Agent 配置').click())
      const labels = ['文风', '题材', '爽点偏好']
      for (const [index, label] of labels.entries()) {
        const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, `preference-${index}`); input.dispatchEvent(new Event('input', { bubbles: true })) })
      }
      expect(host.textContent).toContain('未保存')
      await act(async () => button(host, '保存配置').click())
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
      expect(JSON.parse(String(put[1]!.body)).document.preferences).toEqual({ style: 'preference-0', genre: 'preference-1', payoff: 'preference-2' })
      expect(host.textContent).toContain('配置版本 1')
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/advance'))).toBe(false)
      expect(host.textContent).toContain('source')
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('keeps an unknown save frozen and only retries the exact request on an explicit action', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let fail = true, view = config()
    const puts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-config')) {
        if (init?.method === 'PUT') {
          const request = JSON.parse(String(init.body)); puts.push(request)
          if (fail) throw new Error('transport lost')
          view = { ...view, revision: 1, document: request.document }
          return new Response(JSON.stringify({ workId: 'work-test', revision: 1, requestId: request.requestId, document: request.document }))
        }
        return new Response(JSON.stringify(view))
      }
      return new Response(JSON.stringify(work))
    }))
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      expect(button(host, 'Agent 配置')).toBeDefined()
      await act(async () => button(host, 'Agent 配置').click())
      await act(async () => button(host, '保存配置').click())
      expect(puts).toHaveLength(1)
      expect(host.querySelector<HTMLInputElement>('input[aria-label="文风"]')!.matches(':disabled')).toBe(true)
      await act(async () => button(host, '刷新配置').click())
      expect(puts).toHaveLength(1)
      fail = false
      await act(async () => button(host, '重试原请求').click())
      expect(puts).toHaveLength(2); expect(puts[1]).toEqual(puts[0])
      expect(host.textContent).toContain('配置版本 1')
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('does not erase an earlier unknown write when a frozen retry is rejected', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-config')) {
        if (init?.method === 'PUT') {
          if (++calls === 1) throw new Error('lost original receipt')
          return new Response(JSON.stringify({ code: 'version-conflict', message: 'configuration changed', retryable: false }), { status: 409 })
        }
        return new Response(JSON.stringify(config()))
      }
      return new Response(JSON.stringify(work))
    }))
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      await act(async () => button(host, 'Agent 配置').click())
      await act(async () => button(host, '保存配置').click())
      await act(async () => button(host, '重试原请求').click())
      expect(calls).toBe(2)
      expect(host.textContent).toContain('重试原请求')
      expect(host.querySelector<HTMLInputElement>('input[aria-label="文风"]')!.matches(':disabled')).toBe(true)
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
})
