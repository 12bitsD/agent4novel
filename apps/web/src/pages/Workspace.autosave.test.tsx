// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const initial = { id: 'prose-1', workId: 'save-work', kind: 'prose', chapter: 1, version: 1,
  humanStatus: 'pending', createdAt: '2026-09-29', content: { text: '待通过的第一章。' } }
const work = (prose: typeof initial) => ({ id: 'save-work', title: '自动保存测试', seed: '种子', config: {}, createdAt: '2026-09-29', artifacts: [prose],
  workflowState: prose.humanStatus === 'approved' ? 'prose-approved' : 'awaiting-prose-review', nextStepId: null,
  allowedActions: prose.humanStatus === 'approved' ? ['save-draft'] : ['save-draft', 'approve', 'regenerate'] })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!
async function type(host: HTMLElement, text: string) {
  const input = host.querySelector('#prose-text') as HTMLTextAreaElement
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function saved(baseline: typeof initial, artifact: typeof initial) {
  return { artifact, workflow: { workflowState: work(artifact).workflowState, nextStepId: null, allowedActions: work(artifact).allowedActions }, telemetry: [],
    command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose', executionMode: 'demo', latencyMs: 1,
      target: { workId: artifact.workId, kind: 'prose', chapter: 1 }, expectedHead: { artifactId: baseline.id, version: baseline.version, humanStatus: baseline.humanStatus },
      writeOutcome: 'committed', attemptIds: [], resultHead: { artifactId: artifact.id, version: artifact.version, humanStatus: artifact.humanStatus } } }
}
async function mount(fetchMock: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(<Workspace workId="save-work" onBack={() => {}} />))
  return { host, root, dispose: async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() } }
}

describe('正文自动保存', () => {
  it('saves pending edits without approval and restores the saved text after reopening', async () => {
    let current = initial
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        const request = JSON.parse(init!.body as string)
        expect(request).toEqual({ chapter: 1, expectedArtifactId: 'prose-1', expectedHeadVersion: 1, expectedHumanStatus: 'pending', content: { text: '  已保存的修改。\n\n下一段。\n' } })
        const baseline = current
        current = { ...current, id: 'prose-2', version: 2, content: request.content }
        return json(saved(baseline, current))
      }
      return json(work(current))
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await type(ui.host, '  已保存的修改。\n\n下一段。\n')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/prose/save'))).toHaveLength(1)
      expect(ui.host.textContent).toContain('已保存')
      expect(current.humanStatus).toBe('pending')
      expect(calls.mock.calls.some(([url]) => url.endsWith('/approve') || url.endsWith('/advance'))).toBe(false)
      await act(async () => ui.root.render(<Workspace key="reopened" workId="save-work" onBack={() => {}} />))
      expect(ui.host.textContent).toContain('已保存的修改。')
      expect(ui.host.textContent).not.toContain('第一章已完成')
    } finally { await ui.dispose() }
  })

  it('opens completed prose for editing and saves a new approved version without another approval', async () => {
    let current = { ...initial, humanStatus: 'approved' }
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        const request = JSON.parse(init!.body as string)
        expect(request.expectedHumanStatus).toBe('approved')
        const baseline = current
        current = { ...current, id: 'prose-2', version: 2, content: request.content }
        return json(saved(baseline, current))
      }
      return json(work(current))
    })
    const ui = await mount(calls)
    try {
      expect(ui.host.querySelector('#prose-text')).toBeNull()
      expect(ui.host.textContent).toContain('第一章已完成')
      await act(async () => button(ui.host, '编辑正文').click())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).disabled).toBe(false)
      await type(ui.host, '已通过章节的修改。')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(current.content.text).toBe('已通过章节的修改。')
      expect(current.humanStatus).toBe('approved')
      expect(ui.host.textContent).toContain('第一章已完成')
      expect(button(ui.host, '通过正文')).toBeUndefined()
      expect(calls.mock.calls.some(([url]) => url.endsWith('/approve') || url.endsWith('/advance'))).toBe(false)
    } finally { await ui.dispose() }
  })

  it('keeps typing during a save and sends the later text against the newly saved version', async () => {
    let current = initial
    let finishFirst!: () => void
    const requests: Array<Record<string, unknown>> = []
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        const request = JSON.parse(init!.body as string)
        requests.push(request)
        if (requests.length === 1) await new Promise<void>(resolve => { finishFirst = resolve })
        const baseline = current
        current = { ...current, id: `prose-${current.version + 1}`, version: current.version + 1, content: request.content }
        return json(saved(baseline, current))
      }
      return json(work(current))
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await type(ui.host, '第一次修改')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(ui.host.textContent).toContain('保存中')
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).disabled).toBe(false)
      expect(button(ui.host, '通过正文').disabled).toBe(true)
      await type(ui.host, '保存期间继续写的内容')
      await act(async () => finishFirst())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).value).toBe('保存期间继续写的内容')
      expect(ui.host.textContent).toContain('未保存')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(requests).toHaveLength(2)
      expect(requests[1]).toMatchObject({ expectedArtifactId: 'prose-2', expectedHeadVersion: 2, content: { text: '保存期间继续写的内容' } })
      expect(current.content.text).toBe('保存期间继续写的内容')
      const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    } finally { await ui.dispose() }
  })

  it('reconciles a lost save reply without replacing later edits or submitting the saved text twice', async () => {
    let current = initial
    let writes = 0
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        writes++
        const request = JSON.parse(init!.body as string)
        current = { ...current, id: 'prose-2', version: 2, content: request.content }
        throw new Error('lost save response')
      }
      return json(work(current))
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await type(ui.host, '网络恢复后能找回的正文')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(writes).toBe(1)
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).value).toBe('网络恢复后能找回的正文')
      expect(ui.host.textContent).toContain('已保存')
      expect(button(ui.host, '通过正文').disabled).toBe(false)
      await act(async () => vi.advanceTimersByTimeAsync(2_000))
      expect(writes).toBe(1)
    } finally { await ui.dispose() }
  })

  it('keeps local text and requires a deliberate choice when another save wins', async () => {
    let current = initial
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/prose/save')) {
        current = { ...initial, id: 'other-prose', version: 2, content: { text: '另一处已保存的正文' } }
        return json({ code: 'version-conflict', message: 'conflict', retryable: false, command: {
          kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose', executionMode: 'demo', latencyMs: 1,
          target: { workId: 'save-work', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: 'prose-1', version: 1, humanStatus: 'pending' },
          attemptIds: [], writeOutcome: 'not-committed', failureStage: 'precondition',
        } }, 409)
      }
      return json(work(current))
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await type(ui.host, '冲突时仍保留的本页正文')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).value).toBe('冲突时仍保留的本页正文')
      expect(ui.host.textContent).toContain('服务器版本已变化')
      expect(button(ui.host, '通过正文').disabled).toBe(true)
      await act(async () => vi.advanceTimersByTimeAsync(2_000))
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/prose/save'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })
})
