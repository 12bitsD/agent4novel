// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const creative = {
  id: 'creative-1', workId: 'work-test', kind: 'creative', version: 2,
  humanStatus: 'approved', createdAt: '2026-09-09',
  content: { directions: [{ directionId: 'chosen', title: '已选定的创意', hook: '保留下来的钩子',
    tags: [], synopsis: '完整的创意梗概', characters: [], setting: [], payoffs: [], outline: [] }] },
}
const setting = { ...creative, id: 'setting-1', kind: 'setting', version: 1, humanStatus: 'pending',
  content: { overview: '新生成的设定总览', world: [{ itemId: 'world-1', title: '世界', content: '规则' }],
    characters: [{ itemId: 'person-1', title: '主角', content: '动机' }], factions: [], relationships: [], extensions: [] },
}

describe('Workspace generation continuity', () => {
  it('retains only the selected direction after selection automatically starts generation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let selected = false
    let rejectGeneration: (reason: Error) => void = () => {}
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/select')) { selected = true; return new Response(JSON.stringify(creative)) }
      if (url.endsWith('/advance')) return new Promise<Response>((_resolve, reject) => { rejectGeneration = reject })
      const pending = { ...creative, version: 1, humanStatus: 'pending', content: { directions: [
        { ...creative.content.directions[0], directionId: 'discarded', title: '未选方向' }, ...creative.content.directions,
      ] } }
      return new Response(JSON.stringify({ id: 'work-test', title: '作品', seed: '原始脑洞', config: {}, createdAt: '2026-09-09',
        artifacts: [selected ? creative : pending], workflowState: selected ? 'ready-to-generate' : 'awaiting-selection',
        nextStepId: selected ? 'outline' : null, allowedActions: selected ? ['generate'] : ['save-draft', 'select', 'generate'],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
      await act(async () => (host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!).click())
      await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.startsWith('就按'))!.click())
      expect(host.textContent).toContain('正在生成大纲')
      expect(host.textContent).toContain('完整的创意梗概')
      expect(host.textContent).not.toContain('未选方向')
      expect(host.textContent).not.toContain('脑洞（seed）')
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
      expect(host.querySelectorAll('textarea,input')).toHaveLength(0)
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
      await act(async () => rejectGeneration(new Error('synthetic transport failure')))
    } finally {
      await act(async () => root.unmount()); host.remove(); confirm.mockRestore(); vi.unstubAllGlobals()
    }
  })

  it.each(['outline', 'setting'])('keeps creative read-only while %s is pending and after failure, then shows the new artifact', async nextStepId => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let stage = 'ready'
    let rejectGeneration: (reason: Error) => void = () => {}
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/advance')) return new Promise<Response>((_resolve, reject) => { rejectGeneration = reject })
      return new Response(JSON.stringify({ id: 'work-test', title: '作品', seed: '原始脑洞', config: {}, createdAt: '2026-09-09',
        artifacts: stage === 'done' ? [creative, setting] : [creative],
        workflowState: stage === 'done' ? 'awaiting-setting-review' : stage === 'failed' ? 'failed' : 'ready-to-generate',
        nextStepId: stage === 'done' ? null : nextStepId,
        allowedActions: stage === 'done' ? ['approve'] : ['generate'],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const expectCreative = () => {
      expect(host.textContent).toContain('完整的创意梗概')
      expect(host.textContent).not.toContain('脑洞（seed）')
      expect(host.querySelectorAll('textarea,input')).toHaveLength(0)
    }
    try {
      await act(async () => root.render(<Workspace workId="work-test" onBack={() => {}} />))
      expectCreative()
      const label = nextStepId === 'outline' ? '大纲' : '设定'
      await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === `生成${label}`)!.click())
      expect(host.textContent).toContain(`正在生成${label}`)
      expectCreative()
      stage = 'failed'
      await act(async () => rejectGeneration(new Error('synthetic transport failure')))
      expectCreative()
      expect(host.textContent).toContain(`重试生成${label}`)
      stage = 'done'
      await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '刷新作品')!.click())
      expect(host.textContent).toContain('新生成的设定总览')
      expect(host.textContent).not.toContain('完整的创意梗概')
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/advance'))).toHaveLength(1)
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()
    }
  })
})
