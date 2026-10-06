// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import CreativePoster from './CreativePoster.js'
import OutlineReview from './OutlineReview.js'

const creative = { directions: [{ directionId: 'direction-1', title: '夜班邮局', hook: '信件', tags: [], synopsis: '故事', characters: [], setting: [], payoffs: [], outline: [] }] }
const outline = { arcs: [1, 2, 3].map(i => ({ arcId: 'arc-' + i, title: '弧线', conflict: '冲突', development: '发展', resolution: '局势', segments: [1, 2].map(j => ({ segmentId: 'point-' + i + '-' + j, title: '剧情点', summary: '事件', outcome: '落点' })) })) }
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!

it.each(['creative', 'outline'] as const)('keeps an unknown %s save distinct from failure and reads without repeating the write', async kind => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const artifact = { id: kind + '-remote', workId: 'recovery-work', kind, version: 4, humanStatus: 'pending', createdAt: '2026-10-06', content: kind === 'creative' ? creative : outline }
  const work = { id: 'recovery-work', title: '作品', seed: '脑洞', config: {}, createdAt: '2026-10-06', artifacts: [artifact], currentChapter: 1, chapters: [], workflowState: kind === 'creative' ? 'awaiting-selection' : 'awaiting-outline-review', nextStepId: null, allowedActions: ['save-draft', kind === 'creative' ? 'select' : 'approve'] }
  const calls = vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === 'PUT') throw new TypeError('reply lost'); return new Response(JSON.stringify(work)) }); vi.stubGlobal('fetch', calls)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const guard = vi.fn()
  try {
    await act(async () => root.render(kind === 'creative'
      ? <CreativePoster workId="recovery-work" content={creative} headVersion={3} caption={null} readonly={false} onChanged={() => {}} onGuard={guard} />
      : <OutlineReview workId="recovery-work" artifactId="outline-visible" content={outline} headVersion={3} pack={null} readonly={false} onChanged={() => {}} onGuard={guard} />))
    const field = host.querySelector<HTMLInputElement>(kind === 'creative' ? '[aria-label="方向标题"]' : 'input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '仍需保留的本页编辑')
    await act(async () => field.dispatchEvent(new Event('input', { bubbles: true })))
    await act(async () => button(host, kind === 'creative' ? '保存全部方向' : '保存草稿').click())
    expect(host.textContent).toContain('操作结果尚未确认')
    expect(field.value).toBe('仍需保留的本页编辑')
    expect(guard).toHaveBeenLastCalledWith({ dirty: true, locked: true })
    await act(async () => button(host, '核对服务器内容').click())
    expect(field.value).toBe('仍需保留的本页编辑')
    expect(host.textContent).toContain('服务器当前版本')
    expect(calls.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
    await act(async () => button(host, '载入服务器内容').click())
    await act(async () => button(host, '继续编辑').click())
    expect(field.value).toBe('仍需保留的本页编辑')
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
