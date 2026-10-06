// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const directions = { directions: [{ directionId: 'direction-1', title: '夜班邮局', hook: '寄往明天的信', tags: [], synopsis: '林照找到旧街', characters: [], setting: [], payoffs: [], outline: [] }] }
const outline = { arcs: [1, 2, 3].map(i => ({ arcId: 'arc-' + i, title: '弧线' + i, conflict: '冲突', development: '发展', resolution: '局势改变', segments: [1, 2].map(j => ({ segmentId: 'point-' + i + '-' + j, title: '剧情点', summary: '发生的事', outcome: '落点' })) })) }
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!

it.each(['creative', 'outline'] as const)('protects unsaved %s edits before leaving the work and preserves them on cancel', async kind => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const artifact = { id: kind + '-1', workId: 'guard-work', kind, version: 1, humanStatus: 'pending', createdAt: '2026-10-06', content: kind === 'creative' ? directions : outline }
  const work = { id: 'guard-work', title: '需要保留的作品', seed: '脑洞', config: {}, createdAt: '2026-10-06', artifacts: [artifact], currentChapter: 1, chapters: [], workflowState: kind === 'creative' ? 'awaiting-selection' : 'awaiting-outline-review', nextStepId: null, allowedActions: ['save-draft', kind === 'creative' ? 'select' : 'approve'] }
  const calls = vi.fn(async () => new Response(JSON.stringify(work))); vi.stubGlobal('fetch', calls)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const back = vi.fn()
  try {
    await act(async () => root.render(<Workspace workId="guard-work" onBack={back} />))
    const field = host.querySelector<HTMLInputElement>(kind === 'creative' ? '[aria-label="方向标题"]' : 'input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '本页尚未保存的编辑')
    await act(async () => field.dispatchEvent(new Event('input', { bubbles: true })))
    await act(async () => button(host, '← 返回书架').click())
    expect(back).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => button(host, '继续编辑').click())
    expect(field.value).toBe('本页尚未保存的编辑')
    expect(back).not.toHaveBeenCalled()
    expect(calls.mock.calls).toHaveLength(1)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('keeps edits made after loading a draft while a delayed read observes external progression', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const artifact = { id: 'creative-1', workId: 'guard-work', kind: 'creative', version: 1, humanStatus: 'pending', createdAt: '2026-10-06', content: directions }
  const initial = { id: 'guard-work', title: '需要保留的作品', seed: '脑洞', config: {}, createdAt: '2026-10-06', artifacts: [artifact], currentChapter: 1, chapters: [], workflowState: 'awaiting-selection', nextStepId: null, allowedActions: ['save-draft', 'select'] }
  const remote = { ...initial, artifacts: [{ ...artifact, id: 'creative-2', version: 2 }] }
  const later = { ...initial, workflowState: 'awaiting-outline-review', allowedActions: ['save-draft', 'approve'], artifacts: [{ ...artifact, id: 'creative-3', version: 3, humanStatus: 'approved', content: { directions: [{ ...directions.directions[0], title: '外部方向' }] } }, { ...artifact, id: 'outline-1', kind: 'outline', content: outline }] }
  let reads = 0, release!: (response: Response) => void
  const delayed = new Promise<Response>(resolve => { release = resolve })
  const transport = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') throw new TypeError('reply lost')
    reads++; if (reads === 1) return Response.json(initial); if (reads === 2) return Response.json(remote); return delayed
  }); vi.stubGlobal('fetch', transport)
  const host = document.createElement('div'); document.body.append(host); const renderer = createRoot(host); const back = vi.fn()
  const edit = async (value: string) => { const field = host.querySelector<HTMLInputElement>('[aria-label="方向标题"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); await act(async () => field.dispatchEvent(new Event('input', { bubbles: true }))); return field }
  try {
    await act(async () => renderer.render(<Workspace workId="guard-work" onBack={back} />))
    await edit('第一份本页编辑'); await act(async () => button(host, '保存全部方向').click())
    await act(async () => button(host, '核对服务器内容').click())
    await act(async () => button(host, '载入服务器内容').click())
    await act(async () => button(host, '放弃本页并载入').click())
    expect(reads).toBe(3)
    const field = await edit('载入后继续编辑的方向')
    await act(async () => release(Response.json(later)))
    expect(host.querySelector('[aria-label="方向标题"]')).toBe(field)
    expect(field.value).toBe('载入后继续编辑的方向')
    expect(host.querySelector('[aria-label="大纲关卡"]')).toBeNull()
    await act(async () => button(host, '← 返回书架').click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(back).not.toHaveBeenCalled()
    await act(async () => button(host, '继续编辑').click())
    expect(field.value).toBe('载入后继续编辑的方向')
  } finally { await act(async () => renderer.unmount()); host.remove(); vi.unstubAllGlobals() }
})
