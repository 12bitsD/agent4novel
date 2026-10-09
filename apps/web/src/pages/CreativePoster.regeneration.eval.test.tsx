// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.js'

const pack = (id: string, title: string) => ({ directionId: id, title, hook: `${title} hook`, tags: [], synopsis: `${title} synopsis`, characters: [], setting: [], payoffs: [], outline: [] })
const creative = (version: number, status: 'pending' | 'approved' = 'pending') => ({
  id: `creative-${version}`, workId: 'creative-ui-work', kind: 'creative' as const, version, humanStatus: status,
  createdAt: '2026-10-10', content: { directions: [pack('direction-1', '旧方向'), pack('direction-2', '第二方向')] },
})
const view = (artifact = creative(1)) => ({
  id: 'creative-ui-work', title: '创意再生验收', seed: 'UI unique seed', config: {}, createdAt: '2026-10-10',
  artifacts: [artifact], currentChapter: 1, chapters: [], workflowState: 'awaiting-selection' as const,
  nextStepId: null, allowedActions: ['save-draft', 'select', 'generate'],
})

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('creative regeneration Web acceptance', () => {
  it('E5 preserves the thought and old material, saves dirty edits before regeneration, and locks while loading', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let rejectRegeneration!: (error: Error) => void
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/api/works/creative-ui-work')) return new Response(JSON.stringify(view()))
      if (url.endsWith('/artifacts/creative') && init?.method === 'PUT') return new Response(JSON.stringify(creative(2)))
      if (url.endsWith('/artifacts/creative/regenerate')) return new Promise<Response>((_resolve, reject) => { rejectRegeneration = reject })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="creative-ui-work" onBack={() => {}} />))
      const title = host.querySelector<HTMLInputElement>('input[aria-label="方向标题"]')!
      setValue(title, '本页已改方向')
      const thought = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="补充想法"]')!
      setValue(thought, 'UI unique author thought')
      const regenerate = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('重新生成创意稿'))!
      expect(regenerate).toBeTruthy()
      await act(async () => regenerate.click())
      expect(calls.filter(call => call.url.endsWith('/artifacts/creative') && call.init?.method === 'PUT')).toHaveLength(1)
      const request = calls.find(call => call.url.endsWith('/artifacts/creative/regenerate'))
      expect(request).toBeTruthy()
      expect(JSON.parse(String(request!.init?.body))).toMatchObject({ expectedArtifactId: 'creative-2', expectedHeadVersion: 2, instructions: 'UI unique author thought' })
      expect(thought.disabled).toBe(true)
      expect(title.closest('fieldset')?.hasAttribute('disabled')).toBe(true)
      expect(regenerate.disabled).toBe(true)
      expect(host.textContent).toContain('UI unique author thought')
      await act(async () => rejectRegeneration(new Error('network lost')))
      expect(thought.value).toBe('UI unique author thought')
      expect(host.textContent).toContain('核对服务器内容')
      expect(host.textContent).toContain('旧方向')
      expect(calls.filter(call => call.url.endsWith('/artifacts/creative/regenerate'))).toHaveLength(1)
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()
    }
  })

  it('E5 adopts a successful new pending head without selecting it and clears the thought', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const generated = { ...creative(2), content: { directions: [pack('new-direction', '再生方向')] } }
    let postCount = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/works/creative-ui-work')) return new Response(JSON.stringify(view()))
      if (url.endsWith('/artifacts/creative/regenerate')) { postCount++; return new Response(JSON.stringify(generated)) }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<Workspace workId="creative-ui-work" onBack={() => {}} />))
      const thought = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="补充想法"]')!
      setValue(thought, 'success thought')
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('重新生成创意稿'))!.click())
      expect(postCount).toBe(1)
      expect(host.textContent).toContain('再生方向')
      expect(host.textContent).toContain('重新生成创意稿')
      expect(host.textContent).not.toContain('已选定')
      expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="补充想法"]')!.value).toBe('')
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()
    }
  })
})
