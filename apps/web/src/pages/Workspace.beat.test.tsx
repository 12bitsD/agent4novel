// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const head = { id: 'artifact-test', workId: 'work-test', kind: 'beat', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-08',
  content: { title: '第一章', goal: '目标', writingPlan: [{ itemId: 'beat-item-old', title: '安排', content: '说明' }], ending: '落点' },
}
const view = { id: 'work-test', title: '合成作品', seed: '合成素材', config: {}, createdAt: '2026-09-08', artifacts: [head],
  workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'],
}
describe('Workspace Beat integration', () => {
  it.each(['pending', 'readback-timeout'] as const)('reconciles a lost first-generation response once with %s and never repeats POST', async mode => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    let reads = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/advance')) return new Promise<Response>(() => {})
      if (++reads === 1) return new Response(JSON.stringify({ ...view, artifacts: [], workflowState: 'ready-to-generate', nextStepId: 'beat', allowedActions: ['generate'] }))
      if (mode === 'readback-timeout') return new Promise<Response>(() => {})
      return new Response(JSON.stringify(view))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '生成第一章章纲')!.click())
      expect(host.textContent).toContain('正在生成第一章章纲')
      await act(async () => vi.advanceTimersByTimeAsync(1_820_001))
      if (mode === 'readback-timeout') await act(async () => vi.advanceTimersByTimeAsync(10_001))
      expect(host.textContent).not.toContain('正在生成第一章章纲')
      expect(host.textContent).toContain(mode === 'pending' ? '第一章 · 写作计划' : '读取作品失败')
      if (mode === 'pending') expect(host.textContent).not.toContain('生成第一章章纲')
      expect(reads).toBe(2)
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() }
  })
  it.each(['invalid-response', 'deadline'] as const)('freezes the edited request on %s and performs only one bounded readback', async mode => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    if (mode === 'deadline') vi.useFakeTimers()
    let reads = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/artifacts/beat/approve')) {
        if (mode === 'deadline') return new Promise<Response>(() => {})
        return new Response(JSON.stringify({ malformed: true }))
      }
      if (++reads > 1) throw new Error('synthetic GET unavailable')
      return new Response(JSON.stringify(view))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      const buttons = () => Array.from(host.querySelectorAll('button'))
      await act(async () => buttons().find(b => b.textContent === '编辑章纲')!.click())
      const goal = host.querySelector('#beat-goal') as HTMLTextAreaElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(goal, '作者未提交的最终目标')
        goal.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => buttons().find(b => b.textContent === '通过章纲')!.click())
      if (mode === 'deadline') await act(async () => vi.advanceTimersByTimeAsync(30_001))
      expect(host.textContent).toContain('提交结果尚未确认')
      expect(goal.value).toBe('作者未提交的最终目标')
      expect(goal.disabled).toBe(true)
      expect(reads).toBe(2)
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/artifacts/beat/approve'))).toHaveLength(1)
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/advance'))).toBe(false)
    } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() }
  })
  it('keeps confirmed approval visible when a later GET is stale and omits the Beat', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let approved = false
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/artifacts/beat/approve')) {
        approved = true
        return new Response(JSON.stringify({ artifact: { ...head, humanStatus: 'approved' },
          workflow: { workflowState: 'beat-approved', nextStepId: null, allowedActions: [] }, telemetry: [],
          command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'approve-beat', executionMode: 'demo', latencyMs: 1,
            target: { workId: head.workId, kind: 'beat', chapter: 1 }, expectedHead: { artifactId: head.id, version: 1 },
            writeOutcome: 'committed', attemptIds: [], resultHead: { artifactId: head.id, version: 1, humanStatus: 'approved' } },
        }))
      }
      return new Response(JSON.stringify(approved ? { ...view, artifacts: [], workflowState: 'ready-to-generate', nextStepId: 'beat', allowedActions: ['generate'] } : view))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '通过章纲')!
      await act(async () => button.click())
      expect(host.textContent).toContain('章纲已通过')
      expect(host.textContent).not.toContain('生成第一章章纲')
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/artifacts/beat/approve'))).toHaveLength(1)
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('advances once after confirmed Setting approval, and never generates on a ready-page refresh', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const setting = { ...head, id: 'artifact-setting', kind: 'setting', chapter: undefined,
      content: { overview: '总览', world: [{ itemId: 'world-1', title: '世界', content: '现实' }], characters: [{ itemId: 'character-1', title: '主角', content: '寻找线索' }], factions: [], relationships: [], extensions: [] },
    }
    let approved = false
    let generated = false
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/artifacts/setting/approve')) { approved = true; return new Response(JSON.stringify({ ...setting, humanStatus: 'approved' })) }
      if (url.endsWith('/advance')) { generated = true; return new Response(JSON.stringify({ kind: 'advanced', stepId: 'beat', state: { workId: 'work-test', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'beat', chapter: 1 } }, telemetry: [] })) }
      expect(init?.method ?? 'GET').toBe('GET')
      return new Response(JSON.stringify(generated ? view : { ...view, artifacts: [{ ...setting, humanStatus: approved ? 'approved' : 'pending' }],
        workflowState: approved ? 'ready-to-generate' : 'awaiting-setting-review', allowedActions: approved ? ['generate'] : ['approve'], nextStepId: approved ? 'beat' : null,
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      const approve = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '通过设定')!
      await act(async () => approve.click())
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
      expect(host.textContent).toContain('第一章 · 写作计划')
      generated = false
      await act(async () => root.render(<Workspace key="reopened" workId="work-test" onBack={() => {}} />))
      expect(host.textContent).toContain('生成第一章章纲')
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('retains author instructions, warns on refresh, and navigates only after explicit confirmation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(view)))
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const back = vi.fn()
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={back} />))
      expect(host.textContent).toContain('第一章 · 写作计划')
      const input = host.querySelector('#beat-instructions') as HTMLTextAreaElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '作者未提交意见')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const refresh = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(refresh)
      expect(refresh.defaultPrevented).toBe(true)
      const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('返回书架'))!
      button.focus()
      await act(async () => button.click())
      expect(back).not.toHaveBeenCalled()
      expect(host.querySelector('[role="dialog"]')).not.toBeNull()
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(host.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(button)
      await act(async () => button.click())
      const confirm = Array.from(host.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === '放弃修改并离开') as HTMLButtonElement
      await act(async () => confirm.click())
      expect(back).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
    const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
