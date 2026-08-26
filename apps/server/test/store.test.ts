import { describe, it, expect } from 'vitest'
import { InMemoryStore } from '../src/store/in-memory-store.js'

describe('InMemoryStore', () => {
  it('creates and lists works', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: '脑洞一', title: '作品一' })
    expect(w.id).toMatch(/^work-/)
    const list = store.listWorks()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('作品一')
    expect(list[0].chapterCount).toBe(0)
  })

  it('empty or whitespace title falls back to the seed prefix', () => {
    const store = new InMemoryStore()
    expect(store.createWork({ seed: '一二三四五六七八九十甲乙丙丁戊己庚辛', title: '' }).title).toBe(
      '一二三四五六七八九十甲乙丙丁戊己庚辛',
    )
    expect(store.createWork({ seed: '一个脑洞', title: '   ' }).title).toBe('一个脑洞')
  })

  it('getWork returns undefined for unknown id', () => {
    const store = new InMemoryStore()
    expect(store.getWork('nope')).toBeUndefined()
  })

  it('appends versioned artifacts (JsonValue content) and getWork returns the latest', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    // store 不感知内容形状(JsonValue 透传),用中性 fixture,不绑定具体节点形态
    store.appendArtifact(w.id, 'caption', { note: 'v1' })
    store.appendArtifact(w.id, 'caption', { note: 'v2' })
    const detail = store.getWork(w.id)!
    const caps = detail.artifacts.filter((a) => a.kind === 'caption')
    expect(caps).toHaveLength(1)
    expect(caps[0].version).toBe(2)
    expect((caps[0].content as { note: string }).note).toBe('v2')
  })

  it('per-chapter kind requires a chapter', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(() => store.appendArtifact(w.id, 'beat', 'x')).toThrow(/requires a chapter/)
  })

  it('per-work kind rejects a chapter', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(() => store.appendArtifact(w.id, 'caption', 'x', { chapter: 1 })).toThrow(
      /must not have a chapter/,
    )
  })

  it('setStatus affects the latest version only', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    store.appendArtifact(w.id, 'outline', 'v1')
    store.setStatus(w.id, 'outline', 'approved')
    store.appendArtifact(w.id, 'outline', 'v2')
    const detail = store.getWork(w.id)!
    const outline = detail.artifacts.find((a) => a.kind === 'outline')!
    expect(outline.version).toBe(2)
    expect(outline.humanStatus).toBe('pending')
  })

  it('setStatus on missing artifact throws', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(() => store.setStatus(w.id, 'outline', 'approved')).toThrow(/artifact not found/)
  })

  it('headVersion reflects the latest version, undefined when absent', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(store.headVersion(w.id, 'creative')).toBeUndefined()
    store.appendArtifact(w.id, 'creative', { note: 'v1' })
    expect(store.headVersion(w.id, 'creative')).toBe(1)
    store.appendArtifact(w.id, 'creative', { note: 'v2' })
    expect(store.headVersion(w.id, 'creative')).toBe(2)
  })
})
