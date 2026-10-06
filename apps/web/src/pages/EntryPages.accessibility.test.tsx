// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artifact, CreativeContent, OutlineContent } from '@agent4novel/contracts'
import { approveOutline, saveCreativeDraft, saveOutlineDraft, selectCreativeDirection } from '../api.js'
import Entry from './Entry.js'
import CreativePoster from './CreativePoster.js'
import OutlineReview from './OutlineReview.js'

vi.mock('../api.js', () => ({
  getConfig: vi.fn(async () => ({ demo: true })),
  createWork: vi.fn(async () => ({ id: 'created-work' })),
  saveCreativeDraft: vi.fn(),
  selectCreativeDirection: vi.fn(),
  saveOutlineDraft: vi.fn(),
  approveOutline: vi.fn(),
}))

const directions: CreativeContent = {
  directions: ['一', '二'].map((suffix, i) => ({
    directionId: `direction-${i + 1}`, title: `方向${suffix}`, hook: `钩子${suffix}`,
    tags: ['都市'], synopsis: '故事梗概', characters: [], setting: [], payoffs: [], outline: [],
  })),
}
const outline: OutlineContent = { arcs: [1, 2, 3].map(i => ({
  arcId: `arc-${i}`, title: '开端', conflict: '冲突', development: '发展', resolution: '收束',
  segments: [1, 2].map(j => ({ segmentId: `segment-${i}-${j}`, title: '来信', summary: '发生的事', outcome: '新的局势' })),
})) }

function artifact(kind: 'creative' | 'outline', version: number, content: CreativeContent | OutlineContent): Artifact {
  return { id: `${kind}-${version}`, workId: 'work-1', kind, version, content, humanStatus: 'pending', createdAt: '2026-10-03' }
}

function button(host: HTMLElement, label: string) {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === label)
  expect(result).toBeDefined()
  return result!
}

async function mount(view: React.ReactNode) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(view))
  return { host, async cleanup() { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() } }
}

async function edit(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
  await act(async () => field.dispatchEvent(new Event('input', { bubbles: true })))
}

describe('entry pages accessible editing', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each(['creative', 'outline'] as const)('keeps the %s primary decision beside its material title and save state', async kind => {
    const ui = await mount(kind === 'creative'
      ? <CreativePoster workId="work-1" content={directions} headVersion={3} caption={null} readonly={false} onChanged={() => {}} />
      : <OutlineReview workId="work-1" content={outline} headVersion={3} pack={null} readonly={false} onChanged={() => {}} />)
    try {
      const action = button(ui.host, kind === 'creative' ? '就按「方向一」这个方向写 →' : '通过大纲 →')
      const header = ui.host.querySelector('header')!
      expect(header.contains(action)).toBe(true)
      expect(header.querySelector('[role="status"]')).not.toBeNull()
      expect(ui.host.querySelectorAll('header')).toHaveLength(1)
    } finally { await ui.cleanup() }
  })

  it('keeps the entry material and optional title identifiable beyond their placeholders', async () => {
    const view = await mount(<Entry onBack={() => {}} onCreated={() => {}} />)
    try {
      const labels = Array.from(view.host.querySelectorAll<HTMLLabelElement>('label'))
      const material = labels.find(label => label.textContent === '创作素材')
      const title = labels.find(label => label.textContent === '作品标题（可选）')
      expect(material?.control).toBeInstanceOf(HTMLTextAreaElement)
      expect(title?.control).toBeInstanceOf(HTMLInputElement)
      expect(view.host.textContent).toContain('演示模式')
    } finally { await view.cleanup() }
  })

  it('opens a named direction dialog with cancel focused and preserves drafts on Escape without writing', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const view = await mount(<CreativePoster workId="work-1" content={directions} headVersion={3} caption={null} readonly={false} onChanged={() => {}} />)
    try {
      await edit(view.host.querySelector<HTMLInputElement>('[aria-label="方向标题"]')!, '我的方向')
      const trigger = button(view.host, '就按「我的方向」这个方向写 →')
      trigger.focus()
      await act(async () => trigger.click())
      const dialog = view.host.querySelector<HTMLElement>('[role="dialog"]')
      expect(dialog).not.toBeNull()
      expect(document.getElementById(dialog!.getAttribute('aria-labelledby')!)?.textContent).toBe('选定创作方向')
      expect(document.getElementById(dialog!.getAttribute('aria-describedby')!)?.textContent).toBe('就按「我的方向」这个方向写?选定后其余方向留在历史版本里。')
      expect(document.activeElement?.textContent).toBe('继续编辑')
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(view.host.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(view.host.querySelector<HTMLInputElement>('[aria-label="方向标题"]')?.value).toBe('我的方向')
      expect(saveCreativeDraft).not.toHaveBeenCalled()
      expect(selectCreativeDirection).not.toHaveBeenCalled()
      expect(nativeConfirm).not.toHaveBeenCalled()
    } finally { await view.cleanup(); nativeConfirm.mockRestore() }
  })

  it('confirms the current direction only after saving all modified directions with the original baseline', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const saved = { directions: directions.directions.map((p, i) => i === 0 ? { ...p, hook: '新钩子' } : p) }
    vi.mocked(saveCreativeDraft).mockResolvedValue(artifact('creative', 4, saved))
    vi.mocked(selectCreativeDirection).mockResolvedValue(artifact('creative', 5, saved))
    const selected = vi.fn()
    const view = await mount(<CreativePoster workId="work-1" content={directions} headVersion={3} caption={null} readonly={false} onChanged={() => {}} onSelected={selected} />)
    try {
      await edit(view.host.querySelector<HTMLTextAreaElement>('[aria-label="钩子"]')!, '新钩子')
      await act(async () => button(view.host, '就按「方向一」这个方向写 →').click())
      expect(view.host.querySelector('[role="dialog"]')).not.toBeNull()
      expect(saveCreativeDraft).not.toHaveBeenCalled()
      await act(async () => button(view.host, '确认选定').click())
      expect(saveCreativeDraft).toHaveBeenCalledExactlyOnceWith('work-1', saved, 3)
      expect(selectCreativeDirection).toHaveBeenCalledExactlyOnceWith('work-1', 'direction-1', 4)
      expect(vi.mocked(saveCreativeDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(selectCreativeDirection).mock.invocationCallOrder[0]!)
      expect(selected).toHaveBeenCalledTimes(1)
      expect(view.host.querySelector('[role="dialog"]')).toBeNull()
      expect(nativeConfirm).not.toHaveBeenCalled()
    } finally { await view.cleanup(); nativeConfirm.mockRestore() }
  })

  it('cancels outline approval by default and confirms only after saving the visible outline version', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const saved = { arcs: outline.arcs.map((arc, i) => i === 0 ? { ...arc, title: '修改后的开端' } : arc) }
    vi.mocked(saveOutlineDraft).mockResolvedValue(artifact('outline', 8, saved))
    vi.mocked(approveOutline).mockResolvedValue({ ...artifact('outline', 8, outline), kind: 'outline', chapter: undefined, humanStatus: 'approved', content: outline })
    const approved = vi.fn()
    const view = await mount(<OutlineReview workId="work-1" artifactId="outline-7" content={outline} headVersion={7} pack={null} readonly={false} onChanged={() => {}} onApproved={approved} />)
    try {
      await edit(view.host.querySelector<HTMLInputElement>('[aria-label="弧线 1 标题"]')!, '修改后的开端')
      const trigger = button(view.host, '通过大纲 →')
      trigger.focus()
      await act(async () => trigger.click())
      const dialog = view.host.querySelector<HTMLElement>('[role="dialog"]')
      expect(dialog).not.toBeNull()
      expect(document.getElementById(dialog!.getAttribute('aria-labelledby')!)?.textContent).toBe('通过大纲')
      expect(document.getElementById(dialog!.getAttribute('aria-describedby')!)?.textContent).toBe('通过这份大纲？它将作为设定与后续章节生成的依据。')
      expect(document.activeElement?.textContent).toBe('继续编辑')
      await act(async () => button(view.host, '继续编辑').click())
      expect(view.host.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(saveOutlineDraft).not.toHaveBeenCalled()
      expect(approveOutline).not.toHaveBeenCalled()
      expect(view.host.querySelector<HTMLInputElement>('[aria-label="弧线 1 标题"]')?.value).toBe('修改后的开端')
      await act(async () => trigger.click())
      await act(async () => button(view.host, '确认通过大纲').click())
      expect(saveOutlineDraft).toHaveBeenCalledExactlyOnceWith('work-1', saved, 7)
      expect(approveOutline).toHaveBeenCalledExactlyOnceWith('work-1', { expectedArtifactId: 'outline-8', expectedHeadVersion: 8 })
      expect(vi.mocked(saveOutlineDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(approveOutline).mock.invocationCallOrder[0]!)
      expect(approved).toHaveBeenCalledTimes(1)
      expect(nativeConfirm).not.toHaveBeenCalled()
    } finally { await view.cleanup(); nativeConfirm.mockRestore() }
  })

  it('uses direction choice buttons and keeps each direction draft when switching', async () => {
    const view = await mount(<CreativePoster workId="work-1" content={directions} headVersion={1} caption={null} readonly={false} onChanged={() => {}} />)
    try {
      const group = view.host.querySelector('[role="group"][aria-label="创作方向"]')
      expect(group).not.toBeNull()
      const buttons = Array.from(group!.querySelectorAll<HTMLButtonElement>('button'))
      expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
      await edit(view.host.querySelector<HTMLInputElement>('[aria-label="方向标题"]')!, '修改后的方向一')
      await act(async () => buttons[1]!.click())
      expect(view.host.querySelector<HTMLInputElement>('[aria-label="方向标题"]')?.value).toBe('方向二')
      await act(async () => buttons[0]!.click())
      expect(view.host.querySelector<HTMLInputElement>('[aria-label="方向标题"]')?.value).toBe('修改后的方向一')
      expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true')
    } finally { await view.cleanup() }
  })

  it('names outline editing fields without reopening approved material for editing', async () => {
    const view = await mount(<OutlineReview workId="work-1" content={outline} headVersion={1} pack={null} readonly={false} onChanged={() => {}} />)
    try {
      expect(view.host.querySelector('[aria-label="弧线 1 标题"]')).toBeInstanceOf(HTMLInputElement)
      expect(view.host.querySelector('[aria-label="弧线 1 核心冲突"]')).toBeInstanceOf(HTMLTextAreaElement)
      expect(view.host.querySelector('[aria-label="弧线 1 剧情点 1 标题"]')).toBeInstanceOf(HTMLInputElement)
      expect(view.host.querySelector('[aria-label="弧线 1 剧情点 1 内容"]')).toBeInstanceOf(HTMLTextAreaElement)
    } finally { await view.cleanup() }
    const readonlyView = await mount(<OutlineReview workId="work-1" content={outline} headVersion={1} pack={null} readonly onChanged={() => {}} />)
    try {
      expect(readonlyView.host.querySelector('input, textarea')).toBeNull()
      expect(readonlyView.host.textContent).toContain('发生的事')
      expect(readonlyView.host.textContent).not.toContain('通过大纲 →')
    } finally { await readonlyView.cleanup() }
  })
})
