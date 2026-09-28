// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const beat = { id: 'beat-1', workId: 'work-test', kind: 'beat', chapter: 1, version: 1, humanStatus: 'approved', createdAt: '2026-09-28',
  content: { title: '第一章标题', goal: '保护证人', writingPlan: [{ itemId: 'beat-item-1', title: '行动', content: '关门' }], ending: '门关上' } }
const prose = { id: 'prose-1', workId: 'work-test', kind: 'prose', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-28', content: { text: '模型初稿。' } }
const view = { id: 'work-test', title: '合成作品', seed: '合成素材', config: {}, createdAt: '2026-09-28', artifacts: [beat, prose],
  workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
async function fill(host: HTMLElement, selector: string, text: string) {
  const input = host.querySelector(selector) as HTMLTextAreaElement
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function response(operation: 'approve-prose' | 'regenerate-prose', artifact: typeof prose) {
  return { artifact, workflow: { workflowState: artifact.humanStatus === 'approved' ? 'prose-approved' : 'awaiting-prose-review', nextStepId: null,
    allowedActions: artifact.humanStatus === 'approved' ? [] : ['approve', 'regenerate'] }, telemetry: [],
    command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation, executionMode: 'demo', latencyMs: 1,
      target: { workId: 'work-test', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: 'prose-1', version: 1 },
      writeOutcome: 'committed', attemptIds: [], resultHead: { artifactId: artifact.id, version: artifact.version, humanStatus: artifact.humanStatus } } }
}
async function mount(fetchMock: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
  return { host, root, dispose: async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() } }
}

describe('Workspace first-chapter prose', () => {
  it('approves the exact visible author text and stops at the completed first chapter', async () => {
    let current = prose
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/artifacts/prose/approve')) {
        const request = JSON.parse(init!.body as string)
        expect(request).toEqual({ chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: 1, content: { text: '  作者修改。\n\n保留空行。\n' } })
        current = { ...prose, humanStatus: 'approved', content: request.content }
        return json(response('approve-prose', current))
      }
      return json({ ...view, artifacts: [beat, current], workflowState: current.humanStatus === 'approved' ? 'prose-approved' : view.workflowState })
    })
    const ui = await mount(calls)
    try {
      expect(ui.host.textContent).toContain('模型初稿。')
      expect(ui.host.textContent).toContain('第一章标题')
      await act(async () => button(ui.host, '编辑正文').click())
      await fill(ui.host, '#prose-text', '  作者修改。\n\n保留空行。\n')
      await act(async () => button(ui.host, '通过正文').click())
      expect(ui.host.textContent).toContain('第一章已完成')
      expect(button(ui.host, '编辑正文')).toBeDefined()
      expect(calls.mock.calls.some(([url]) => url.endsWith('/advance'))).toBe(false)
    } finally { await ui.dispose() }
  })
  it('starts prose only once after this page approves Beat, but never on reopening a ready work', async () => {
    let stage = 'beat'
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/artifacts/beat/approve')) {
        stage = 'ready'
        const result = response('approve-prose', { ...prose, humanStatus: 'approved' })
        return json({ ...result, artifact: beat, workflow: { workflowState: 'ready-to-generate', nextStepId: 'prose', allowedActions: ['generate'] },
          command: { ...result.command, operation: 'approve-beat', target: { workId: 'work-test', kind: 'beat', chapter: 1 }, expectedHead: { artifactId: beat.id, version: 1 }, resultHead: { artifactId: beat.id, version: 1, humanStatus: 'approved' } } })
      }
      if (url.endsWith('/advance')) {
        stage = 'prose'
        return json({ kind: 'advanced', stepId: 'prose', state: { workId: 'work-test', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'prose', chapter: 1 } }, telemetry: [] })
      }
      return json(stage === 'prose' ? view : { ...view, artifacts: [{ ...beat, humanStatus: stage === 'beat' ? 'pending' : 'approved' }],
        workflowState: stage === 'beat' ? 'awaiting-beat-review' : 'ready-to-generate', nextStepId: stage === 'beat' ? null : 'prose', allowedActions: stage === 'beat' ? ['approve', 'regenerate'] : ['generate'] })
    })
    const ui = await mount(calls)
    try {
      const approve = Array.from(ui.host.querySelectorAll('button')).find(b => b.textContent?.includes('通过') && !b.textContent?.includes('重新'))!
      await act(async () => { approve.click(); approve.click() })
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
      expect(ui.host.textContent).toContain('模型初稿。')
      stage = 'ready'
      await act(async () => ui.root.render(<Workspace key="reopened" workId="work-test" onBack={() => {}} />))
      expect(ui.host.textContent).toContain('生成第一章正文')
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })

  it('keeps local text and instructions on rewrite failure and replaces them only after explicit successful rewrite', async () => {
    let fail = true
    let current = prose
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/artifacts/prose/regenerate')) {
        expect(JSON.parse(init!.body as string)).toMatchObject({ content: { text: '作者当前全文' }, instructions: '降低语气' })
        if (fail) return json({ code: 'llm-timeout', message: 'timeout', retryable: true, command: {
          kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'regenerate-prose',
          target: { workId: 'work-test', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: prose.id, version: 1 },
          executionMode: 'demo', latencyMs: 1, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'model',
        } }, 504)
        current = { ...prose, id: 'prose-2', version: 2, content: { text: '重新写出的全文' } }
        return json(response('regenerate-prose', current))
      }
      return json({ ...view, artifacts: [beat, current] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await fill(ui.host, '#prose-text', '作者当前全文'); await fill(ui.host, '#prose-instructions', '降低语气')
      await act(async () => button(ui.host, '整章重写').click())
      await act(async () => button(ui.host, '继续编辑').click())
      expect(calls.mock.calls.some(([url]) => url.endsWith('/regenerate'))).toBe(false)
      await act(async () => button(ui.host, '整章重写').click())
      await act(async () => button(ui.host, '确认整章重写').click())
      expect((ui.host.querySelector('#prose-text') as HTMLTextAreaElement).value).toBe('作者当前全文')
      expect((ui.host.querySelector('#prose-instructions') as HTMLTextAreaElement).value).toBe('降低语气')
      expect(ui.host.textContent).toContain('本次未写入')
      await act(async () => button(ui.host, '继续编辑').click()); fail = false
      await act(async () => button(ui.host, '整章重写').click())
      await act(async () => button(ui.host, '确认整章重写').click())
      expect(ui.host.textContent).toContain('重新写出的全文')
      expect((ui.host.querySelector('#prose-instructions') as HTMLTextAreaElement).value).toBe('')
      expect(ui.host.textContent).not.toContain('第一章已完成')
    } finally { await ui.dispose() }
  })
  it('keeps an unknown rewrite frozen until the author explicitly loads a different server version', async () => {
    let writes = 0
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/regenerate')) { writes++; throw new Error('lost reply') }
      return json({ ...view, artifacts: [beat, writes ? { ...prose, id: 'prose-2', version: 2, content: { text: '未知来源服务器新版' } } : prose] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await fill(ui.host, '#prose-text', '保留的人工正文'); await fill(ui.host, '#prose-instructions', '保留的意见')
      await act(async () => button(ui.host, '整章重写').click()); await act(async () => button(ui.host, '确认整章重写').click())
      const input = ui.host.querySelector('#prose-text') as HTMLTextAreaElement
      expect(input.value).toBe('保留的人工正文'); expect(input.disabled).toBe(true)
      expect(ui.host.textContent).toContain('服务器版本已变化')
      expect(writes).toBe(1)
      await act(async () => button(ui.host, '载入服务器正文').click())
      expect(input.value).toBe('保留的人工正文')
      await act(async () => button(ui.host, '放弃并载入').click())
      expect(ui.host.textContent).toContain('未知来源服务器新版')
      expect(writes).toBe(1)
    } finally { await ui.dispose() }
  })

  it('isolates local prose edits when the workId changes without remounting the caller', async () => {
    const calls = vi.fn(async (url: string) => json(url.endsWith('/work-next') ? { ...view, id: 'work-next', artifacts: [{ ...prose, id: 'next-prose', workId: 'work-next', content: { text: '另一作品正文' } }] } : view))
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '编辑正文').click())
      await fill(ui.host, '#prose-text', '仅旧作品的修改')
      await act(async () => ui.root.render(<Workspace workId="work-next" onBack={() => {}} />))
      expect(ui.host.textContent).toContain('另一作品正文')
      expect(ui.host.textContent).not.toContain('仅旧作品的修改')
      expect(button(ui.host, '通过正文').disabled).toBe(false)
    } finally { await ui.dispose() }
  })

  it('confirms a lost Beat approval with one readback and starts prose once', async () => {
    let reads = 0; let writes = 0
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/artifacts/beat/approve')) { writes++; throw new Error('lost approval response') }
      if (url.endsWith('/advance')) return json({ kind: 'advanced', stepId: 'prose', state: { workId: 'work-test', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'prose', chapter: 1 } }, telemetry: [] })
      reads++
      if (reads > 2) return json(view)
      return json({ ...view, artifacts: [{ ...beat, humanStatus: writes ? 'approved' : 'pending' }], workflowState: writes ? 'ready-to-generate' : 'awaiting-beat-review', nextStepId: writes ? 'prose' : null, allowedActions: writes ? ['generate'] : ['approve', 'regenerate'] })
    })
    const ui = await mount(calls)
    try {
      await act(async () => button(ui.host, '通过章纲并生成正文').click())
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
      expect(reads).toBe(3) // initial, one reconciliation, post-generation refresh
      expect(writes).toBe(1)
      expect(ui.host.textContent).toContain('模型初稿。')
    } finally { await ui.dispose() }
  })

  it('requires explicit approval despite instructions, warns on leaving, and bounds unknown waits', async () => {
    vi.useFakeTimers()
    let reads = 0
    const calls = vi.fn(async (url: string) => {
      if (url.endsWith('/approve')) return new Promise<Response>(() => {})
      if (++reads > 1) return new Promise<Response>(() => {})
      return json(view)
    })
    const ui = await mount(calls)
    try {
      await fill(ui.host, '#prose-instructions', '仅用于重写的意见')
      const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)
      await act(async () => button(ui.host, '通过正文').click())
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(0)
      expect(ui.host.textContent).toContain('不会应用修改意见')
      await act(async () => button(ui.host, '继续编辑').click())
      expect((ui.host.querySelector('#prose-instructions') as HTMLTextAreaElement).value).toBe('仅用于重写的意见')
      await act(async () => button(ui.host, '通过正文').click()); await act(async () => button(ui.host, '仍然通过当前正文').click())
      await act(async () => vi.advanceTimersByTimeAsync(30_001)); await act(async () => vi.advanceTimersByTimeAsync(10_001))
      expect(ui.host.textContent).toContain('提交结果尚未确认')
      expect((ui.host.querySelector('#prose-instructions') as HTMLTextAreaElement).disabled).toBe(true)
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(1)
      expect(calls.mock.calls.some(([url]) => url.endsWith('/regenerate') || url.endsWith('/advance'))).toBe(false)
      expect(reads).toBe(2)
    } finally { await ui.dispose() }
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false)
  })

})
