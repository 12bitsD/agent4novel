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

  it('getWork returns undefined for unknown id', () => {
    const store = new InMemoryStore()
    expect(store.getWork('nope')).toBeUndefined()
  })

  it('appends versioned artifacts and getWork returns the latest', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    store.appendArtifact(w.id, 'hook', 'v1')
    store.appendArtifact(w.id, 'hook', 'v2')
    const detail = store.getWork(w.id)!
    const hooks = detail.artifacts.filter((a) => a.kind === 'hook')
    expect(hooks).toHaveLength(1)
    expect(hooks[0].version).toBe(2)
    expect(hooks[0].content).toBe('v2')
  })

  it('per-chapter kind requires a chapter', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(() => store.appendArtifact(w.id, 'beat', 'x')).toThrow(/requires a chapter/)
  })

  it('per-work kind rejects a chapter', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(() => store.appendArtifact(w.id, 'hook', 'x', { chapter: 1 })).toThrow(/must not have a chapter/)
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
    expect(outline.status).toBe('pending')
  })

  it('setStatus on missing artifact throws', () => {
    const store = new InMemoryStore()
    const w = store.createWork({ seed: 'x' })
    expect(() => store.setStatus(w.id, 'outline', 'approved')).toThrow(/artifact not found/)
  })
})
