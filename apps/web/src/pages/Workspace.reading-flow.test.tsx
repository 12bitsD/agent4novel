// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const base = { workId: 'reading-work', version: 1, createdAt: '2026-10-03' }
const beat = (chapter: number) => ({ ...base, id: `beat-${chapter}`, kind: 'beat', chapter, humanStatus: 'approved',
  content: { title: `章标题 ${chapter}`, goal: '目标', writingPlan: [{ itemId: `plan-${chapter}`, title: '行动', content: '开门' }], ending: '门已打开' } })
const prose = (chapter: number) => ({ ...base, id: `prose-${chapter}`, kind: 'prose', chapter, humanStatus: 'approved', content: { text: `阅读正文 ${chapter}。` } })
const summary = (chapter: number) => ({ chapter, title: `章标题 ${chapter}`, beatStatus: 'approved', proseStatus: 'approved',
  allowedActions: chapter === 2 ? ['save-draft', 'start-next-chapter'] : ['save-draft'], needsContinuityReview: false })
const work = () => ({ id: base.workId, title: '阅读作品', seed: '脑洞', config: {}, createdAt: base.createdAt,
  artifacts: [beat(1), prose(1), beat(2), prose(2)], currentChapter: 2, chapters: [summary(1), summary(2)],
  workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft', 'start-next-chapter'] })
const json = (body: unknown) => new Response(JSON.stringify(body))
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === text)
async function mount(fetchMock: (url: string, init?: RequestInit) => Promise<Response>, options: { wide?: boolean; width?: number; chapter?: number } = {}) {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: options.width === undefined
    ? options.wide ?? false : options.width >= Number(query.match(/min-width:\s*(\d+)px/)?.[1]) })))
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(<Workspace workId={base.workId} initialChapter={options.chapter} onBack={() => {}} />))
  return { host, dispose: async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() } }
}
async function edit(host: HTMLElement, value: string) {
  await act(async () => button(host, '编辑正文')!.click())
  const input = host.querySelector<HTMLTextAreaElement>('#prose-text')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('reading flow in the chapter workspace', () => {
  it('keeps the same book workspace and identity while another chapter is being read', async () => {
    let reads = 0
    let resolveRead!: (response: Response) => void
    const delayed = new Promise<Response>(resolve => { resolveRead = resolve })
    const ui = await mount(async url => url === '/api/works/reading-work' && ++reads > 1 ? delayed : json(work()), { chapter: 1, wide: true })
    try {
      const shell = ui.host.querySelector('main')!
      await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')!.click())
      expect(ui.host.querySelector('main')).toBe(shell)
      expect(ui.host.textContent).toContain('阅读作品')
      await act(async () => resolveRead(json(work())))
      expect(ui.host.querySelector('.prose-preview')!.textContent).toBe('阅读正文 2。')
    } finally { await ui.dispose() }
  })

  it('preserves the author opened directory when moving between chapters on a compact screen', async () => {
    const ui = await mount(async () => json(work()), { chapter: 1, width: 375 })
    try {
      const directory = ui.host.querySelector<HTMLDetailsElement>('details')!
      await act(async () => directory.querySelector('summary')!.click())
      expect(directory.open).toBe(true)
      await act(async () => ui.host.querySelector<HTMLButtonElement>('[data-chapter="2"]')!.click())
      expect(ui.host.querySelector<HTMLDetailsElement>('details')!.open).toBe(true)
      expect(ui.host.querySelector('.prose-preview')!.textContent).toBe('阅读正文 2。')
    } finally { await ui.dispose() }
  })

  it.each([768, 890, 900])('keeps the %ipx reading column available with a collapsed directory and preserves the author toggle on resize', async width => {
    const options = { width }
    const calls = vi.fn(async (_url: string, _init?: RequestInit) => json(work()))
    const ui = await mount(calls, options)
    try {
      const directory = ui.host.querySelector<HTMLDetailsElement>('details')!
      const preview = ui.host.querySelector('.prose-preview')!
      expect(directory.open).toBe(false)
      await act(async () => directory.querySelector('summary')!.click())
      expect(directory.open).toBe(true)
      options.width = 1440
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(directory.open).toBe(true)
      expect(ui.host.querySelector('.prose-preview')).toBe(preview)
      options.width = 375
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(directory.open).toBe(true)
      expect(calls.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    } finally { await ui.dispose() }
  })

  it('starts the 901px side directory open at the layout boundary', async () => {
    const ui = await mount(async () => json(work()), { width: 901 })
    try {
      expect(ui.host.querySelector<HTMLDetailsElement>('details')!.open).toBe(true)
    } finally { await ui.dispose() }
  })

  it('starts with a compact mobile directory while keeping one chapter navigation and one readable prose', async () => {
    const calls = vi.fn(async (_url: string, _init?: RequestInit) => json(work()))
    const ui = await mount(calls)
    try {
      const directory = ui.host.querySelector<HTMLDetailsElement>('details')!
      expect(directory).not.toBeNull()
      expect(directory.open).toBe(false)
      const toggle = directory.querySelector('summary')!
      expect(toggle.textContent).toContain('章节目录')
      expect(toggle.textContent).toContain('第 2 章')
      expect(ui.host.querySelectorAll('nav[aria-label="章节目录"]')).toHaveLength(1)
      expect(ui.host.querySelectorAll('.prose-preview')).toHaveLength(1)
      expect(ui.host.querySelector('.prose-preview')!.textContent).toBe('阅读正文 2。')
      await act(async () => toggle.click())
      expect(directory.open).toBe(true)
      await act(async () => directory.querySelector<HTMLButtonElement>('[data-chapter="1"]')!.click())
      expect(ui.host.querySelector('.prose-preview')!.textContent).toBe('阅读正文 1。')
      expect(ui.host.querySelector('[data-chapter="1"]')!.getAttribute('aria-current')).toBe('page')
      expect(calls.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    } finally { await ui.dispose() }
  })

  it('starts with an expanded desktop directory that can still collapse without losing prose', async () => {
    const ui = await mount(async () => json(work()), { wide: true })
    try {
      const directory = ui.host.querySelector<HTMLDetailsElement>('details')!
      expect(directory).not.toBeNull()
      expect(directory.open).toBe(true)
      await act(async () => directory.querySelector('summary')!.click())
      expect(directory.open).toBe(false)
      expect(ui.host.querySelector('.prose-preview')!.textContent).toBe('阅读正文 2。')
      expect(ui.host.querySelectorAll('nav[aria-label="章节目录"] [data-chapter]')).toHaveLength(2)
    } finally { await ui.dispose() }
  })

  it('places the only next-chapter action in the prose header and submits the original saved version', async () => {
    const calls = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/chapters/start')
      ? new Promise<Response>(() => {}) : json(work()))
    const ui = await mount(calls)
    try {
      const header = ui.host.querySelector('[aria-label="正文关卡"] header')!
      const start = button(ui.host, '开始下一章')!
      expect(header.contains(start)).toBe(true)
      expect(Array.from(ui.host.querySelectorAll('button')).filter(item => item.textContent === '开始下一章')).toHaveLength(1)
      expect(header.textContent).toContain('先生成下一章章纲')
      expect(ui.host.querySelector('[aria-label="当前创作内容"]')!.textContent?.match(/第 2 章/g)).toHaveLength(1)
      expect(calls.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      await act(async () => start.click())
      const startRequests = calls.mock.calls.filter(([url]) => url.endsWith('/chapters/start'))
      expect(startRequests).toHaveLength(1)
      expect(JSON.parse(String(startRequests[0]![1]!.body))).toEqual({ chapter: 3, expectedPreviousProseId: 'prose-2', expectedPreviousProseVersion: 1 })
    } finally { await ui.dispose() }
  })

  it('keeps the history header editable without offering a next chapter or a second approval', async () => {
    const calls = vi.fn(async (_url: string, _init?: RequestInit) => json(work()))
    const ui = await mount(calls, { chapter: 1 })
    try {
      const header = ui.host.querySelector('[aria-label="正文关卡"] header')!
      expect(header.textContent).toContain('历史阅读')
      expect(button(ui.host, '开始下一章')).toBeUndefined()
      expect(button(ui.host, '通过正文')).toBeUndefined()
      expect(button(ui.host, '整章重写')).toBeUndefined()
      await act(async () => button(ui.host, '编辑正文')!.click())
      expect(ui.host.querySelector<HTMLTextAreaElement>('#prose-text')!.disabled).toBe(false)
      expect(calls.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    } finally { await ui.dispose() }
  })

  it('announces a successful autosave once and keeps the next-chapter guard while edits are unsaved', async () => {
    let view = work()
    const calls = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prose/save')) {
        const request = JSON.parse(String(init!.body))
        const saved = { ...prose(2), id: 'prose-2-v2', version: 2, content: request.content }
        view = { ...view, artifacts: [beat(1), prose(1), beat(2), saved] }
        return json({ artifact: saved, workflow: { workflowState: 'prose-approved', nextStepId: null, allowedActions: ['save-draft', 'start-next-chapter'] }, telemetry: [],
          command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose',
            target: { workId: base.workId, kind: 'prose', chapter: 2 }, expectedHead: { artifactId: 'prose-2', version: 1, humanStatus: 'approved' },
            resultHead: { artifactId: saved.id, version: saved.version, humanStatus: 'approved' }, executionMode: 'demo', latencyMs: 1, attemptIds: [], writeOutcome: 'committed' } })
      }
      return json(view)
    })
    const ui = await mount(calls)
    try {
      await edit(ui.host, '修改后的阅读正文。')
      expect(button(ui.host, '开始下一章')!.disabled).toBe(true)
      await act(async () => vi.advanceTimersByTimeAsync(800))
      const stage = ui.host.querySelector('[aria-label="当前创作内容"]')!
      expect(stage.textContent?.match(/已保存/g)).toHaveLength(1)
      expect(Array.from(stage.querySelectorAll('[role="status"]')).filter(item => item.textContent?.includes('已保存'))).toHaveLength(1)
      expect(button(ui.host, '开始下一章')!.disabled).toBe(false)
      expect(calls.mock.calls.filter(([url]) => url.endsWith('/prose/save'))).toHaveLength(1)
    } finally { await ui.dispose() }
  })

  it('retains the unknown-save announcement and recovery controls beside a locked chapter directory', async () => {
    let writes = 0
    const ui = await mount(async (url: string) => {
      if (url.endsWith('/prose/save')) { writes++; throw new Error('lost receipt') }
      if (writes) throw new Error('read unavailable')
      return json(work())
    })
    try {
      await edit(ui.host, '保存中的阅读正文。')
      await act(async () => vi.advanceTimersByTimeAsync(800))
      expect(Array.from(ui.host.querySelectorAll('[role="status"]')).some(item => item.textContent?.includes('提交结果尚未确认'))).toBe(true)
      expect(button(ui.host, '核对服务器结果')).toBeDefined()
      expect(button(ui.host, '重试同一份请求')).toBeDefined()
      expect(button(ui.host, '开始下一章')!.disabled).toBe(true)
      expect(ui.host.querySelector<HTMLButtonElement>('[data-chapter="1"]')!.disabled).toBe(true)
    } finally { await ui.dispose() }
  })
})
