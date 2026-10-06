// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import OutlineReview from './OutlineReview.js'

const content = { arcs: [1, 2, 3].map(i => ({ arcId: 'arc-' + i, title: '弧线', conflict: '冲突', development: '发展', resolution: '局势', segments: [1, 2].map(j => ({ segmentId: 'point-' + i + '-' + j, title: '剧情点', summary: '事件', outcome: '落点' })) })) }
const observed = { id: 'outline-visible', workId: 'version-work', kind: 'outline', version: 3, humanStatus: 'approved', createdAt: '2026-10-06', content }
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!

it('approves the author visible outline identity and version without reading a newer head', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const calls = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/artifacts/outline/approve') ? observed : { workId: 'version-work', stage: 'ready', nextStepId: 'setting' })))
  vi.stubGlobal('fetch', calls)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const approved = vi.fn()
  try {
    await act(async () => root.render(<OutlineReview workId="version-work" artifactId="outline-visible" content={content} headVersion={3} pack={null} readonly={false} onChanged={() => {}} onApproved={approved} />))
    await act(async () => button(host, '通过大纲 →').click())
    await act(async () => button(host, '确认通过大纲').click())
    expect(calls).toHaveBeenCalledTimes(1)
    expect(calls.mock.calls[0]?.[0]).toBe('/api/works/version-work/artifacts/outline/approve')
    expect(JSON.parse(calls.mock.calls[0]?.[1]?.body as string)).toEqual({ expectedArtifactId: 'outline-visible', expectedHeadVersion: 3 })
    expect(approved).toHaveBeenCalledTimes(1)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
