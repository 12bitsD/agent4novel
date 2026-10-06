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
