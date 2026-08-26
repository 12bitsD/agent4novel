import { describe, it, expect } from 'vitest'
import type { CreativePack } from '@agent4novel/contracts'
import {
  activePack,
  beginSave,
  beginSelect,
  commandFailed,
  editActive,
  initCompare,
  isDirty,
  savePayload,
  saveSucceeded,
  switchTab,
} from '../src/creative-compare.js'

function pack(directionId: string, title: string): CreativePack {
  return {
    directionId,
    title,
    hook: `hook-${title}`,
    tags: ['都市'],
    synopsis: '概要。',
    characters: [],
    setting: [],
    payoffs: [],
    outline: [],
  }
}

const content = { directions: [pack('d1', 'A'), pack('d2', 'B')] }

describe('creative-compare(纯状态/command 映射)', () => {
  it('init: 默认激活第一个方向,无 dirty', () => {
    const s = initCompare(content, 1)
    expect(s.activeId).toBe('d1')
    expect(isDirty(s)).toBe(false)
    expect(s.headVersion).toBe(1)
  })

  it('tab 按 directionId 绑定:与下标/标题无关', () => {
    let s = initCompare(content, 1)
    s = switchTab(s, 'd2')
    expect(activePack(s).title).toBe('B')
    // 未知 id 不切换
    expect(switchTab(s, 'nope').activeId).toBe('d2')
  })

  it('编辑走本地缓存,不影响 baseline;directionId 不可被 patch 改掉', () => {
    let s = initCompare(content, 1)
    s = editActive(s, { title: 'A改' })
    expect(activePack(s).title).toBe('A改')
    expect(s.packs[0]!.title).toBe('A')
    expect(isDirty(s)).toBe(true)
    // 类型上 patch 不含 directionId;运行时再兜底一次
    s = editActive(s, { directionId: 'hacked' } as Partial<CreativePack>)
    expect(activePack(s).directionId).toBe('d1')
  })

  it('save 载荷 = 全部方向(draft 覆盖 baseline)', () => {
    let s = initCompare(content, 1)
    s = editActive(s, { title: 'A改' })
    s = switchTab(s, 'd2')
    s = editActive(s, { hook: 'B新钩子' })
    const payload = savePayload(s)
    expect(payload.directions).toHaveLength(2)
    expect(payload.directions[0]!.title).toBe('A改')
    expect(payload.directions[1]!.hook).toBe('B新钩子')
  })

  it('保存/选定互斥:saving 中不能 select,无 dirty 不能 save', () => {
    let s = initCompare(content, 1)
    expect(beginSave(s).saving).toBe(false) // 无 dirty 不发起
    s = editActive(s, { title: 'x' })
    s = beginSave(s)
    expect(s.saving).toBe(true)
    expect(beginSelect(s).selecting).toBe(false)
    expect(editActive(s, { title: 'y' }).drafts['d1']!.title).toBe('x') // 提交中编辑被忽略
  })

  it('select 提交的是当前 tab 的 directionId', () => {
    let s = initCompare(content, 1)
    s = switchTab(s, 'd2')
    s = beginSelect(s)
    expect(s.selecting).toBe(true)
    expect(s.activeId).toBe('d2')
  })

  it('保存成功:baseline 更新、dirty 清空、headVersion 前进', () => {
    let s = initCompare(content, 1)
    s = editActive(s, { title: 'A改' })
    s = beginSave(s)
    s = saveSucceeded(s, 2)
    expect(s.headVersion).toBe(2)
    expect(isDirty(s)).toBe(false)
    expect(s.packs[0]!.title).toBe('A改')
  })

  it('409(version-conflict)后保留 dirty edits 并标记 conflict', () => {
    let s = initCompare(content, 1)
    s = editActive(s, { title: 'A改' })
    s = beginSave(s)
    s = commandFailed(s, 'version-conflict')
    expect(s.conflict).toBe(true)
    expect(s.saving).toBe(false)
    expect(activePack(s).title).toBe('A改') // 编辑不丢
    expect(isDirty(s)).toBe(true)
  })

  it('其他错误:只复位 busy,不报 conflict', () => {
    let s = initCompare(content, 1)
    s = editActive(s, { title: 'A改' })
    s = beginSelect(s)
    s = commandFailed(s, 'llm-unavailable')
    expect(s.selecting).toBe(false)
    expect(s.conflict).toBe(false)
  })
})
