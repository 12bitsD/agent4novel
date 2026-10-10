// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { authorStepIds, type AuthorConfigSave, type AuthorConfigView } from '@agent4novel/contracts'
import Workspace from './Workspace.js'

const base = { workId: 'config-navigation-work', version: 1, createdAt: '2026-10-03' }
const beat = (chapter: number, approved = true) => ({ ...base, id: `beat-${chapter}`, kind: 'beat', chapter, humanStatus: approved ? 'approved' : 'pending',
  content: { title: `章节 ${chapter}`, goal: `目标 ${chapter}`, writingPlan: [{ itemId: `plan-${chapter}`, title: '行动', content: '行动内容' }], ending: '落点' } })
const prose = { ...base, id: 'prose-1', kind: 'prose', chapter: 1, humanStatus: 'approved', content: { text: '已保存的第一章' } }
const first = { id: base.workId, title: '配置导航', seed: '脑洞', config: {}, createdAt: base.createdAt, currentChapter: 1,
  artifacts: [beat(1), prose], workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft', 'start-next-chapter'],
  chapters: [{ chapter: 1, title: '章节 1', beatStatus: 'approved', proseStatus: 'approved', allowedActions: ['save-draft', 'start-next-chapter'], needsContinuityReview: false }] }
const second = { ...first, currentChapter: 2, artifacts: [...first.artifacts, beat(2, false)], workflowState: 'awaiting-beat-review', allowedActions: ['approve', 'regenerate'],
  chapters: [{ ...first.chapters[0], allowedActions: ['save-draft'] }, { chapter: 2, title: '章节 2', beatStatus: 'pending', proseStatus: null, allowedActions: ['approve', 'regenerate'], needsContinuityReview: false }] }
const initialConfig = (): AuthorConfigView => ({ workId: base.workId, revision: 0, document: { preferences: {}, defaults: {}, steps: {} }, files: [],
  effective: authorStepIds.map(id => ({ id, model: 'kimi:kimi-k2.8-highspeed', provider: 'kimi', configured: false, executionMode: 'demo', generation: {}, appliedPreferences: {}, systemPrompt: null, skills: [], tools: [], directionCount: 2 })) })
const json = (body: unknown) => new Response(JSON.stringify(body))
const startReceipt = { kind: 'advanced', stepId: 'beat', state: { workId: base.workId, stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'beat', chapter: 2 } }, telemetry: [] }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
const preference = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label="文风"]')
async function editPreference(host: HTMLElement) {
  await act(async () => {
    const input = preference(host)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '尚未保存的文风')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function mount(fetchMock: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(<Workspace workId={base.workId} onBack={() => {}} />))
  await act(async () => button(host, 'Agent 配置').click())
  return { host, dispose: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() } }
}

describe('配置与自动切章保护', () => {
  it('keeps unsaved configuration on the current chapter without starting another chapter', async () => {
    const calls = vi.fn(async (url: string, _init?: RequestInit) => json(url.endsWith('/agent-config') ? initialConfig() : first))
    const ui = await mount(calls)
    try {
      await editPreference(ui.host)
      expect(button(ui.host, '开始下一章').disabled).toBe(true)
      await act(async () => button(ui.host, '开始下一章').click())
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      expect(calls.mock.calls.some(([url]) => url.endsWith('/chapters/start'))).toBe(false)
    } finally { await ui.dispose() }
  })
  it('retains a configuration draft created while the next chapter is being generated', async () => {
    let started = false
    let finishStart!: () => void
    const calls = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/agent-config')) return json(initialConfig())
      if (url.endsWith('/chapters/start')) {
        await new Promise<void>(resolve => { finishStart = resolve })
        started = true
        return json(startReceipt)
      }
      return json(started ? second : first)
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      await editPreference(ui.host)
      await act(async () => finishStart())
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      expect(ui.host.querySelector('[data-chapter="1"]')?.getAttribute('aria-current')).toBe('page')
      expect(ui.host.querySelector('[data-chapter="2"]')).not.toBeNull()
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })
  it('preserves a configuration draft when a lost start response is recovered from the work', async () => {
    let started = false
    let finishStart!: () => void
    const calls = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/agent-config')) return json(initialConfig())
      if (url.endsWith('/chapters/start')) {
        await new Promise<void>(resolve => { finishStart = resolve })
        started = true
        throw new Error('lost start receipt')
      }
      return json(started ? second : first)
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      await editPreference(ui.host)
      await act(async () => finishStart())
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      expect(ui.host.querySelector('[data-chapter="1"]')?.getAttribute('aria-current')).toBe('page')
      expect(ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')?.disabled).toBe(false)
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })
  it('does not discard a configuration draft when explicitly confirming an unknown start', async () => {
    let targetVisible = false
    const calls = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/agent-config')) return json(initialConfig())
      if (url.endsWith('/chapters/start')) throw new Error('lost start receipt')
      return json(targetVisible ? second : first)
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      expect(ui.host.textContent).toContain('结果尚未确认')
      await editPreference(ui.host)
      targetVisible = true
      await act(async () => button(ui.host, '刷新作品').click())
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      expect(ui.host.querySelector('[data-chapter="1"]')?.getAttribute('aria-current')).toBe('page')
      expect(ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')?.disabled).toBe(false)
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })
  it.each(['saving', 'unknown'] as const)('does not start another chapter while a configuration save is %s', async state => {
    const saved = deferred<void>()
    let config = initialConfig(), retry = false, started = false
    const writes: AuthorConfigSave[] = []
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-config')) {
        if (init?.method === 'PUT') {
          const request = JSON.parse(String(init.body)) as AuthorConfigSave; writes.push(request)
          if (state === 'saving') await saved.promise
          else if (!retry) throw new Error('lost configuration receipt')
          config = { ...config, revision: 1, document: request.document }
          return json({ workId: base.workId, revision: 1, requestId: request.requestId, document: request.document })
        }
        return json(config)
      }
      if (url.endsWith('/chapters/start')) { started = true; return json(startReceipt) }
      return json(started ? second : first)
    })
    const ui = await mount(calls)
    try {
      await editPreference(ui.host)
      await act(async () => button(ui.host, '保存配置').click())
      expect(button(ui.host, '开始下一章').disabled).toBe(true)
      await act(async () => button(ui.host, '开始下一章').click())
      expect(calls.mock.calls.some(([url]) => url.endsWith('/chapters/start'))).toBe(false)
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      if (state === 'saving') await act(async () => saved.resolve())
      else {
        expect(button(ui.host, '重试原请求')).toBeDefined()
        retry = true
        await act(async () => button(ui.host, '重试原请求').click())
        expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0])
      }
      expect(button(ui.host, '开始下一章').disabled).toBe(false)
      await act(async () => button(ui.host, '开始下一章').click())
      expect(ui.host.textContent).toContain('目标 2')
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })
  it.each([
    ['success', 'saving'], ['success', 'unknown'],
    ['lost', 'saving'], ['lost', 'unknown'],
    ['confirm', 'saving'], ['confirm', 'unknown'],
  ] as const)('retains a %s start target without abandoning configuration that became %s', async (receipt, state) => {
    const start = deferred<void>(), save = deferred<void>()
    let config = initialConfig(), targetVisible = false, retry = false
    const writes: AuthorConfigSave[] = []
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-config')) {
        if (init?.method === 'PUT') {
          const request = JSON.parse(String(init.body)) as AuthorConfigSave; writes.push(request)
          if (state === 'saving') await save.promise
          else if (!retry) throw new Error('lost configuration receipt')
          config = { ...config, revision: 1, document: request.document }
          return json({ workId: base.workId, revision: 1, requestId: request.requestId, document: request.document })
        }
        return json(config)
      }
      if (url.endsWith('/chapters/start')) {
        await start.promise
        targetVisible = receipt !== 'confirm'
        if (receipt !== 'success') throw new Error('lost start receipt')
        return json(startReceipt)
      }
      return json(targetVisible ? second : first)
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      await editPreference(ui.host)
      await act(async () => button(ui.host, '保存配置').click())
      await act(async () => start.resolve())
      if (receipt === 'confirm') {
        targetVisible = true
        await act(async () => button(ui.host, '刷新作品').click())
      }
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      expect(ui.host.querySelector('[data-chapter="1"]')?.getAttribute('aria-current')).toBe('page')
      expect(ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')?.disabled).toBe(true)
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
      if (state === 'saving') await act(async () => save.resolve())
      else {
        expect(button(ui.host, '重试原请求')).toBeDefined()
        retry = true
        await act(async () => button(ui.host, '重试原请求').click())
        expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0])
      }
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      expect(ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')?.disabled).toBe(false)
      await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')!.click())
      expect(ui.host.textContent).toContain('目标 2')
      expect(preference(ui.host)).toBeNull()
    } finally { await ui.dispose() }
  })
  it('allows explicit discard before selecting an already generated next chapter', async () => {
    const start = deferred<void>()
    let targetVisible = false
    const calls = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/agent-config')) return json(initialConfig())
      if (url.endsWith('/chapters/start')) { await start.promise; targetVisible = true; return json(startReceipt) }
      return json(targetVisible ? second : first)
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '开始下一章').click())
      await editPreference(ui.host)
      await act(async () => start.resolve())
      await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')!.click())
      expect(ui.host.querySelector('[role="dialog"]')).not.toBeNull()
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      await act(async () => button(ui.host, '继续编辑').click())
      expect(preference(ui.host)?.value).toBe('尚未保存的文风')
      await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')!.click())
      await act(async () => button(ui.host, '放弃修改并切换').click())
      expect(ui.host.textContent).toContain('目标 2')
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })
  it('allows starting the next chapter after explicitly loading saved server configuration', async () => {
    let started = false
    const calls = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/agent-config')) return json(initialConfig())
      if (url.endsWith('/chapters/start')) { started = true; return json(startReceipt) }
      return json(started ? second : first)
    })
    const ui = await mount(calls)
    try {
      await editPreference(ui.host)
      await act(async () => button(ui.host, '加载服务器配置').click())
      expect(preference(ui.host)?.value).toBe('')
      expect(button(ui.host, '开始下一章').disabled).toBe(false)
      await act(async () => button(ui.host, '开始下一章').click())
      expect(ui.host.textContent).toContain('目标 2')
    } finally { await ui.dispose() }
  })
})
