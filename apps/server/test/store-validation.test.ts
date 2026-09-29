import { afterEach, describe, expect, it } from 'vitest'
import { artifactKinds, type HumanStatus } from '@agent4novel/contracts'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { SqliteStore } from '../src/store/sqlite-store.js'

describe.each(['memory', 'sqlite'] as const)('%s Store validation', adapter => {
  const opened: SqliteStore[] = []
  afterEach(() => { for (const store of opened.splice(0)) store.close() })
  const createStore = () => {
    if (adapter === 'memory') return new InMemoryStore()
    const store = new SqliteStore(':memory:')
    opened.push(store)
    return store
  }


it.each(artifactKinds)('refuses invalid %s append without creating a bucket or consuming a version', kind => {
  const store = createStore()
  const work = store.createWork({ seed: '故事' })
  const opts = ['beat', 'prose'].includes(kind) ? { chapter: 2 } : undefined
  expect(() => store.appendArtifact(work.id, kind, { secret: 'PRIVATE_VALIDATION_MARKER' }, opts)).toThrow()
  expect(store.getWork(work.id)!.artifacts).toEqual([])
  expect(store.headVersion(work.id, kind, opts)).toBeUndefined()
})

it('accepts pending prose edits but atomically refuses an empty finalization or approved edit', () => {
  const store = createStore()
  const work = store.createWork({ seed: '故事' })
  const pending = store.appendArtifact(work.id, 'prose', { text: '' }, { chapter: 2 })
  const target = { workId: work.id, kind: 'prose' as const, chapter: 2, expectedArtifactId: pending.id, expectedHeadVersion: 1 }
  expect(() => store.finalizeArtifact({ ...target, content: { text: ' \n' } })).toThrow()
  expect(store.getWork(work.id)!.artifacts).toEqual([pending])
  const approved = store.finalizeArtifact({ ...target, content: { text: '作者已通过正文' } })
  expect(() => store.saveArtifact({ ...target, expectedHumanStatus: 'approved', content: { text: '' } })).toThrow()
  expect(store.getWork(work.id)!.artifacts).toEqual([approved])
  expect(store.headVersion(work.id, 'prose', { chapter: 2 })).toBe(1)
})

it('validates metadata and status without mutating a valid head', () => {
  const store = createStore()
  const work = store.createWork({ seed: '故事' })
  const content = { inputStage: '脑洞', summary: '故事', elements: [], gaps: [] }
  expect(() => store.appendArtifact(work.id, 'caption', content, { inputs: [{ kind: 'prose', artifactId: 'p', version: 1 }] })).toThrow()
  const pending = store.appendArtifact(work.id, 'caption', content)
  expect(pending.version).toBe(1)
  expect(() => store.setStatus(work.id, 'caption', 'published' as HumanStatus)).toThrow()
  expect(store.getWork(work.id)!.artifacts).toEqual([pending])
})

it('rejects invalid creation at the store boundary before creating a work', () => {
  const store = createStore()
  expect(() => store.createWork({ seed: '' })).toThrow()
  expect(store.listWorks()).toEqual([])
})

it('checks the actual head before invalid edited content and keeps errors free of input values', () => {
  const store = createStore()
  const work = store.createWork({ seed: '故事' })
  const pending = store.appendArtifact(work.id, 'prose', { text: '正文' }, { chapter: 1 })
  const target = { workId: work.id, kind: 'prose' as const, chapter: 1, expectedArtifactId: pending.id, expectedHeadVersion: 99, content: { SECRET_PRIVATE_MARKER: true } }
  expect(() => store.finalizeArtifact(target)).toThrow(expect.objectContaining({ code: 'version-conflict' }))
  try { store.finalizeArtifact({ ...target, expectedHeadVersion: 1 }); throw new Error('expected refusal') }
  catch (error) { expect(String(error)).not.toContain('SECRET_PRIVATE_MARKER') }
  expect(store.getWork(work.id)!.artifacts).toEqual([pending])
})

})
