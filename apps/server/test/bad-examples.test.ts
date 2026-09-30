import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SqliteStore } from '../src/store/sqlite-store.js'
import { createProductionApp } from '../src/runtime/production-app.js'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'a4n-bad-example-')), path = join(dir, 'db.sqlite')
  const store = new SqliteStore(path), work = store.createWork({ seed: '合成素材' })
  const text = '先😀同段，再同段。尾'
  const prose = store.appendArtifact(work.id, 'prose', { text }, { chapter: 1 })
  const input = { requestId: randomUUID(), chapter: 1, sourceArtifactId: prose.id, sourceVersion: prose.version, sourceHash: hash(text), start: text.lastIndexOf('同段'), end: text.lastIndexOf('同段') + 2, text: '同段', note: '重复而空泛' }
  return { dir, path, store, work, prose, text, input, app: createProductionApp(store, undefined, dir).app,
    close: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

describe('immutable bad examples', () => {
  it('marks saved pending prose via HTTP, binds the repeated occurrence, and never changes work', async () => {
    const f = fixture()
    try {
      const before = f.store.getWork(f.work.id)
      const response = await f.app.request(`/api/works/${f.work.id}/bad-examples`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.input) })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: f.input.requestId, workId: f.work.id, text: '同段', start: f.input.start, sourceHash: f.input.sourceHash })
      expect(f.store.getWork(f.work.id)).toEqual(before)
    } finally { f.close() }
  })
  it('returns the same receipt after source finalization, later prose edits, and true reopen', () => {
    const f = fixture()
    try {
      const first = f.store.markBadExample(f.work.id, f.input)
      const approved = f.store.finalizeArtifact({ workId: f.work.id, kind: 'prose', chapter: 1, expectedArtifactId: f.prose.id, expectedHeadVersion: 1, content: { text: '通过时修改了整段文字' } })
      f.store.saveArtifact({ workId: f.work.id, kind: 'prose', chapter: 1, expectedArtifactId: approved.id, expectedHeadVersion: 1, expectedHumanStatus: 'approved', content: { text: '更新后的已通过正文' } })
      expect(f.store.markBadExample(f.work.id, f.input)).toEqual(first)
      f.store.close()
      const reopened = new SqliteStore(f.path)
      try { expect(reopened.getBadExample(f.work.id, first.id)).toEqual(first); expect(reopened.listBadExamples(f.work.id, { chapter: 1 }).items).toEqual([first]) }
      finally { reopened.close() }
    } finally { f.close() }
  })
  it('rejects changed identity but preserves distinct notes and marks an older saved version', () => {
    const f = fixture()
    try {
      const record = f.store.markBadExample(f.work.id, f.input)
      expect(() => f.store.markBadExample(f.work.id, { ...f.input, note: 'changed identity' })).toThrow()
      const second = f.store.markBadExample(f.work.id, { ...f.input, requestId: randomUUID(), note: '另一个评价' })
      expect(second.id).not.toBe(record.id)
      f.store.saveArtifact({ workId: f.work.id, kind: 'prose', chapter: 1, expectedArtifactId: f.prose.id, expectedHeadVersion: 1, expectedHumanStatus: 'pending', content: { text: '新稿' } })
      expect(f.store.markBadExample(f.work.id, { ...f.input, requestId: randomUUID() }).text).toBe('同段')
    } finally { f.close() }
  })
  it.each(['chapter', 'sourceVersion', 'sourceHash', 'text', 'split-surrogate', 'other-work', 'other-kind'])('rejects %s without a partial sample', variation => {
    const f = fixture()
    try {
      const input = { ...f.input }
      if (variation === 'chapter') input.chapter = 2
      if (variation === 'sourceVersion') input.sourceVersion = 2
      if (variation === 'sourceHash') input.sourceHash = 'f'.repeat(64)
      if (variation === 'text') input.text = '错段'
      if (variation === 'split-surrogate') { input.start = 1; input.end = 2; input.text = '\ud83d' }
      if (variation === 'other-work') input.sourceArtifactId = f.store.appendArtifact(f.store.createWork({ seed: '另一个作品' }).id, 'prose', { text: '同段' }, { chapter: 1 }).id
      if (variation === 'other-kind') input.sourceArtifactId = f.store.appendArtifact(f.work.id, 'caption', { inputStage: '脑洞', summary: '合成概要', elements: [], gaps: [] }).id
      expect(() => f.store.markBadExample(f.work.id, input)).toThrow()
      expect(f.store.listBadExamples(f.work.id, {}).items).toEqual([])
    } finally { f.close() }
  })
  it('keeps Unicode whole and paginates bounded work/chapter records without duplication', () => {
    const f = fixture()
    try {
      const unicode = f.store.markBadExample(f.work.id, { ...f.input, start: 1, end: 3, text: '😀' })
      expect(unicode.text).toBe('😀')
      for (let i = 0; i < 51; i++) f.store.markBadExample(f.work.id, { ...f.input, requestId: randomUUID(), note: String(i) })
      const one = f.store.listBadExamples(f.work.id, { chapter: 1 })
      expect(one.items).toHaveLength(50); expect(one.nextCursor).toBeDefined()
      const two = f.store.listBadExamples(f.work.id, { chapter: 1, after: one.nextCursor })
      expect(two.items).toHaveLength(2); expect(two.nextCursor).toBeUndefined()
      expect(new Set([...one.items, ...two.items].map(x => x.id)).size).toBe(52)
      expect(f.store.listBadExamples(f.work.id, { chapter: 2 }).items).toEqual([])
    } finally { f.close() }
  })
  it('migrates exact v2 and keeps existing works and author configuration', () => {
    const f = fixture()
    try {
      f.store.saveAuthorConfig(f.work.id, { requestId: randomUUID(), expectedRevision: 0, document: { preferences: { style: '合成风格' }, defaults: {}, steps: {} } })
      const before = f.store.getWork(f.work.id), config = f.store.getAuthorConfig(f.work.id)
      f.store.close()
      const raw = new Database(f.path); raw.exec('DROP INDEX bad_example_work_chapter; DROP TABLE bad_examples; PRAGMA user_version = 2'); raw.close()
      const reopened = new SqliteStore(f.path)
      try { expect(reopened.getWork(f.work.id)).toEqual(before); expect(reopened.getAuthorConfig(f.work.id)).toEqual(config); expect(reopened.markBadExample(f.work.id, f.input).text).toBe('同段') }
      finally { reopened.close() }
    } finally { f.close() }
  })
  it('deduplicates across connections and isolates bad-example reads by work', () => {
    const f = fixture(), other = new SqliteStore(f.path)
    try {
      const first = f.store.markBadExample(f.work.id, f.input)
      expect(other.markBadExample(f.work.id, f.input)).toEqual(first)
      const otherWork = f.store.createWork({ seed: '另一个作品' })
      expect(other.getBadExample(otherWork.id, first.id)).toBeUndefined()
      expect(() => other.markBadExample(otherWork.id, f.input)).toThrow()
      expect(f.store.listBadExamples(f.work.id, {}).items).toHaveLength(1)
    } finally { other.close(); f.close() }
  })
  it('marks approved saved text and rejects a changed full source even when the selected fragment still matches', () => {
    const f = fixture()
    try {
      f.store.finalizeArtifact({ workId: f.work.id, kind: 'prose', chapter: 1, expectedArtifactId: f.prose.id, expectedHeadVersion: 1, content: f.prose.content })
      expect(f.store.markBadExample(f.work.id, f.input).text).toBe('同段')
      const raw = new Database(f.path)
      try { raw.prepare('UPDATE artifacts SET content = ? WHERE id = ?').run(JSON.stringify({ text: f.text + '追加改变' }), f.prose.id) } finally { raw.close() }
      expect(() => f.store.markBadExample(f.work.id, { ...f.input, requestId: randomUUID() })).toThrow('selection source content changed')
      expect(f.store.listBadExamples(f.work.id, {}).items).toHaveLength(1)
    } finally { f.close() }
  })
  it('enforces HTTP byte/UTF8/query limits and returns exact public reads', async () => {
    const f = fixture()
    try {
      const record = f.store.markBadExample(f.work.id, f.input), base = `/api/works/${f.work.id}/bad-examples`
      expect(await (await f.app.request(`${base}/${record.id}`)).json()).toEqual(record)
      expect(await (await f.app.request(`${base}?chapter=1`)).json()).toMatchObject({ workId: f.work.id, chapter: 1, items: [record] })
      for (const suffix of ['?chapter=0', '?chapter=1&chapter=2', '?after=1e2', '?after=9007199254740992', '?extra=1']) expect((await f.app.request(base + suffix)).status).toBe(400)
      expect((await f.app.request(base, { method: 'POST', body: new Uint8Array([0xff, 0xfe]) })).status).toBe(400)
      expect((await f.app.request(base, { method: 'POST', body: 'x'.repeat(196609) })).status).toBe(413)
      expect((await f.app.request(`${base}/${randomUUID()}`)).status).toBe(404)
      expect(f.store.listBadExamples(f.work.id, {}).items).toHaveLength(1)
    } finally { f.close() }
  })
  it('fails safely on corrupted stored sample associations without leaking text', async () => {
    const f = fixture()
    try {
      const record = f.store.markBadExample(f.work.id, f.input), raw = new Database(f.path)
      try { raw.prepare('UPDATE bad_examples SET record = ? WHERE id = ?').run(JSON.stringify({ ...record, workId: 'wrong', text: '密文' }), record.id) } finally { raw.close() }
      const response = await f.app.request(`/api/works/${f.work.id}/bad-examples/${record.id}`)
      expect(response.status).toBe(500); expect(await response.text()).not.toContain('密文')
    } finally { f.close() }
  })
})
