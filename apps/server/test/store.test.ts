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

  it('returns an isolated work snapshot when creating a work', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'original seed', title: 'original title' })
    work.title = 'outside change'
    work.config.skills = ['outside skill']

    expect(store.getWork(work.id)).toMatchObject({
      title: 'original title',
      seed: 'original seed',
      config: {},
    })
    expect(store.getWork(work.id)!.config.skills).toBeUndefined()
  })

  it('reading a work cannot mutate its stored config or artifact tree', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    store.appendArtifact(work.id, 'caption', { nested: { note: 'original' } })
    const read = store.getWork(work.id)!
    read.config.tools = ['outside tool']
    const content = read.artifacts[0].content as { nested: { note: string } }
    content.nested.note = 'outside change'
    read.artifacts[0].humanStatus = 'approved'
    read.artifacts.length = 0

    expect(store.getWork(work.id)!.config.tools).toBeUndefined()
    expect(store.getWork(work.id)!.artifacts).toMatchObject([
      { humanStatus: 'pending', content: { nested: { note: 'original' } } },
    ])
  })

  it('appending copies content and returns an independent artifact snapshot', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const content = { cards: [{ note: 'original' }] }
    const appended = store.appendArtifact(work.id, 'caption', content)
    content.cards[0].note = 'changed input'
    expect(store.getWork(work.id)!.artifacts[0].content).toEqual({ cards: [{ note: 'original' }] })

    const returnedContent = appended.content as typeof content
    returnedContent.cards[0].note = 'changed output'
    appended.humanStatus = 'approved'
    expect(store.getWork(work.id)!.artifacts[0]).toMatchObject({
      content: { cards: [{ note: 'original' }] },
      humanStatus: 'pending',
    })
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

  it('refuses to append a generated result after an upstream head changed', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const outline = store.appendArtifact(work.id, 'outline', { note: 'original' })
    store.setStatus(work.id, 'outline', 'approved')
    store.appendArtifact(work.id, 'outline', { note: 'updated' })
    const before = store.getWork(work.id)

    expect(() => store.appendArtifact(work.id, 'setting', { note: 'stale result' }, {
      preconditions: [{
        kind: 'outline',
        head: { artifactId: outline.id, version: outline.version, humanStatus: 'approved' },
      }],
    })).toThrow(expect.objectContaining({ code: 'upstream-changed' }))
    expect(store.getWork(work.id)).toEqual(before)
    expect(store.headVersion(work.id, 'setting')).toBeUndefined()
  })

  it('finalizes edited content and approval together without changing artifact identity or version', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })

    const approved = store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      expectedArtifactId: pending.id,
      expectedHeadVersion: pending.version,
      content: { note: 'author edited' },
    })

    expect(approved).toEqual({
      ...pending,
      humanStatus: 'approved',
      content: { note: 'author edited' },
    })
    expect(store.getWork(work.id)!.artifacts).toEqual([approved])
    expect(store.headVersion(work.id, 'setting')).toBe(1)
    expect(pending).toMatchObject({ humanStatus: 'pending', content: { note: 'generated' } })
  })

  it.each([
    { expectedArtifactId: 'another-artifact', expectedHeadVersion: 1 },
    { expectedArtifactId: undefined, expectedHeadVersion: 2 },
  ])('rejects a stale finalization target without changing content or status: %j', (expected) => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })

    expect(() => store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      expectedArtifactId: expected.expectedArtifactId ?? pending.id,
      expectedHeadVersion: expected.expectedHeadVersion,
      content: { note: 'stale edit' },
    })).toThrow(expect.objectContaining({ code: 'version-conflict' }))
    expect(store.getWork(work.id)!.artifacts).toEqual([pending])
  })

  it.each(['author edited', 'a competing edit'])('rejects a repeated finalization with content %j', (note) => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })
    const request = {
      workId: work.id,
      kind: 'setting' as const,
      expectedArtifactId: pending.id,
      expectedHeadVersion: pending.version,
      content: { note: 'author edited' },
    }
    const approved = store.finalizeArtifact(request)

    expect(() => store.finalizeArtifact({ ...request, content: { note } }))
      .toThrow(expect.objectContaining({ code: 'artifact-already-approved' }))
    expect(store.getWork(work.id)!.artifacts).toEqual([approved])
  })

  it('cannot finalize while an upstream head no longer satisfies the approved precondition', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const outline = store.appendArtifact(work.id, 'outline', { note: 'outline' })
    store.setStatus(work.id, 'outline', 'approved')
    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })
    store.setStatus(work.id, 'outline', 'pending')
    const before = store.getWork(work.id)

    expect(() => store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      expectedArtifactId: pending.id,
      expectedHeadVersion: pending.version,
      content: { note: 'edited' },
      preconditions: [{
        kind: 'outline',
        head: { artifactId: outline.id, version: outline.version, humanStatus: 'approved' },
      }],
    })).toThrow(expect.objectContaining({ code: 'upstream-changed' }))
    expect(store.getWork(work.id)).toEqual(before)
  })

  it.each(['pending', 'approved'] as const)('blocks the generic setStatus path for setting status %s', (status) => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })

    expect(() => store.setStatus(work.id, 'setting', status))
      .toThrow(expect.objectContaining({ code: 'setting-approval-required' }))
    expect(store.getWork(work.id)!.artifacts).toEqual([pending])

    const approved = store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      expectedArtifactId: pending.id,
      expectedHeadVersion: pending.version,
      content: pending.content,
    })
    expect(() => store.setStatus(work.id, 'setting', status))
      .toThrow(expect.objectContaining({ code: 'setting-approval-required' }))
    expect(store.getWork(work.id)!.artifacts).toEqual([approved])
  })

  it('validates bucket addresses in conditional writes before committing', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    expect(() => store.appendArtifact(work.id, 'setting', { note: 'generated' }, {
      preconditions: [{ kind: 'outline', chapter: 1, head: null }],
    })).toThrow(/must not have a chapter/)
    expect(store.getWork(work.id)!.artifacts).toEqual([])

    expect(() => store.appendArtifact(work.id, 'setting', { note: 'generated' }, {
      preconditions: [{ kind: 'beat', head: null }],
    })).toThrow(/requires a chapter/)
    expect(store.getWork(work.id)!.artifacts).toEqual([])

    expect(() => store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      chapter: 1,
      expectedArtifactId: 'missing',
      expectedHeadVersion: 1,
      content: { note: 'edited' },
    })).toThrow(/must not have a chapter/)
  })

  it('appends only when every upstream matches and the output bucket is absent', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const outline = store.appendArtifact(work.id, 'outline', { note: 'outline' })
    store.setStatus(work.id, 'outline', 'approved')
    const preconditions = [
      {
        kind: 'outline' as const,
        head: { artifactId: outline.id, version: 1, humanStatus: 'approved' as const },
      },
      { kind: 'setting' as const, head: null },
    ]
    const setting = store.appendArtifact(work.id, 'setting', { note: 'generated' }, { preconditions })
    expect(setting).toMatchObject({ version: 1, humanStatus: 'pending' })

    expect(() => store.appendArtifact(work.id, 'setting', { note: 'competing generation' }, { preconditions }))
      .toThrow(expect.objectContaining({ code: 'version-conflict' }))
    expect(store.headVersion(work.id, 'setting')).toBe(1)
    expect(store.getWork(work.id)!.artifacts.find((artifact) => artifact.kind === 'setting')).toEqual(setting)
  })

  it.each([
    { artifactId: 'foreign-id', version: 1, humanStatus: 'approved' as const },
    { artifactId: undefined, version: 2, humanStatus: 'approved' as const },
    { artifactId: undefined, version: 1, humanStatus: 'pending' as const },
  ])('checks every component of an upstream head: %j', (head) => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const outline = store.appendArtifact(work.id, 'outline', { note: 'outline' })
    store.setStatus(work.id, 'outline', 'approved')
    const before = store.getWork(work.id)

    expect(() => store.appendArtifact(work.id, 'setting', { note: 'generated' }, {
      preconditions: [{ kind: 'outline', head: { ...head, artifactId: head.artifactId ?? outline.id } }],
    })).toThrow(expect.objectContaining({ code: 'upstream-changed' }))
    expect(store.getWork(work.id)).toEqual(before)
  })

  it('scopes preconditions and finalization to the exact chapter bucket', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const first = store.appendArtifact(work.id, 'beat', { note: 'first chapter' }, { chapter: 1 })
    const second = store.appendArtifact(work.id, 'beat', { note: 'second chapter' }, {
      chapter: 2,
      preconditions: [{ kind: 'beat', chapter: 2, head: null }],
    })
    const approved = store.finalizeArtifact({
      workId: work.id,
      kind: 'beat',
      chapter: 2,
      expectedArtifactId: second.id,
      expectedHeadVersion: second.version,
      content: { note: 'edited second chapter' },
      preconditions: [{
        kind: 'beat',
        chapter: 1,
        head: { artifactId: first.id, version: 1, humanStatus: 'pending' },
      }],
    })
    expect(store.getWork(work.id)!.artifacts).toEqual([first, approved])
  })

  it('copies finalization input and output without leaking approved content', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })
    const content = { cards: [{ note: 'author edited' }] }
    const approved = store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      expectedArtifactId: pending.id,
      expectedHeadVersion: pending.version,
      content,
    })
    content.cards[0].note = 'outside input change'
    const returnedContent = approved.content as typeof content
    returnedContent.cards[0].note = 'outside output change'
    approved.humanStatus = 'pending'
    expect(store.getWork(work.id)!.artifacts).toMatchObject([{
      humanStatus: 'approved',
      version: 1,
      content: { cards: [{ note: 'author edited' }] },
    }])
  })

  it('leaves no append or partial approval when copying the input fails', () => {
    const store = new InMemoryStore()
    const work = store.createWork({ seed: 'x' })
    const uncloneable = new Proxy({ note: 'invalid boundary input' }, {})
    expect(() => store.appendArtifact(work.id, 'setting', uncloneable)).toThrow()
    expect(store.getWork(work.id)!.artifacts).toEqual([])
    expect(store.headVersion(work.id, 'setting')).toBeUndefined()

    const pending = store.appendArtifact(work.id, 'setting', { note: 'generated' })
    expect(pending.version).toBe(1)
    expect(() => store.finalizeArtifact({
      workId: work.id,
      kind: 'setting',
      expectedArtifactId: pending.id,
      expectedHeadVersion: pending.version,
      content: uncloneable,
    })).toThrow()
    expect(store.getWork(work.id)!.artifacts).toEqual([pending])
  })

  it('reports missing finalization targets without creating anything', () => {
    const store = new InMemoryStore()
    const request = {
      workId: 'missing-work',
      kind: 'setting' as const,
      expectedArtifactId: 'missing-artifact',
      expectedHeadVersion: 1,
      content: { note: 'edited' },
    }
    expect(() => store.finalizeArtifact(request)).toThrow(expect.objectContaining({ code: 'work-not-found' }))
    expect(store.listWorks()).toEqual([])

    const work = store.createWork({ seed: 'x' })
    expect(() => store.finalizeArtifact({ ...request, workId: work.id }))
      .toThrow(expect.objectContaining({ code: 'version-conflict' }))
    expect(store.getWork(work.id)!.artifacts).toEqual([])
  })
})
