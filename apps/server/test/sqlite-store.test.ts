import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SqliteStore } from '../src/store/sqlite-store.js'
import { caption, setting } from './fixtures/artifact-content.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0).reverse()) clean()
})
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'a4n-sqlite-store-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, 'work.sqlite')
}
function open(path: string): SqliteStore {
  const store = new SqliteStore(path)
  cleanups.push(() => store.close())
  return store
}
function raw(path: string): Database.Database {
  const db = new Database(path)
  cleanups.push(() => { if (db.open) db.close() })
  return db
}

describe('SQLite persistence', () => {
  it('restores config, all artifact versions, status and inputs after reconnect', () => {
    const path = databasePath()
    const store = open(path)
    const work = store.createWork({ seed: 'reconnect', title: 'A title' })
    const source = store.appendArtifact(work.id, 'caption', caption('source'), { humanStatus: 'approved' })
    const inputs = [{ kind: 'caption' as const, artifactId: source.id, version: 1 }]
    const first = store.appendArtifact(work.id, 'prose', { text: ' \noriginal\n ' }, { chapter: 1, inputs })
    const saved = store.saveArtifact({ workId: work.id, kind: 'prose', chapter: 1, expectedArtifactId: first.id, expectedHeadVersion: 1, expectedHumanStatus: 'pending', content: { text: ' revised\n ' } })
    const approved = store.finalizeArtifact({ workId: work.id, kind: 'prose', chapter: 1, expectedArtifactId: saved.id, expectedHeadVersion: 2, content: saved.content })
    store.appendArtifact(work.id, 'setting', setting('pending'))
    const config = { model: 'test-model', temperature: 0.4, topP: 0.9, thinking: 'disabled', directionCount: 2, skills: ['skills/test.md'], systemPrompt: 'test prompt' }
    raw(path).prepare('UPDATE works SET config = ? WHERE id = ?').run(JSON.stringify(config), work.id)
    const before = store.getWork(work.id)
    expect(before!.config).toEqual(config)
    store.close()
    const reopened = open(path)
    expect(reopened.getWork(work.id)).toEqual(before)
    expect(reopened.listWorks()).toEqual([{ id: work.id, title: work.title, seedPreview: work.seed, chapterCount: 1 }])
    expect(reopened.getWork(work.id)!.artifacts.find(a => a.kind === 'prose')).toEqual(approved)
    const versions = raw(path).prepare('SELECT version, human_status, content, inputs FROM artifacts WHERE kind = ? ORDER BY version').all('prose')
    expect(versions).toEqual([
      { version: 1, human_status: 'pending', content: JSON.stringify(first.content), inputs: JSON.stringify(inputs) },
      { version: 2, human_status: 'approved', content: JSON.stringify(approved.content), inputs: JSON.stringify(inputs) },
    ])
  })

  it('refuses future schema versions without rebuilding or changing them', () => {
    const path = databasePath()
    const db = raw(path)
    db.exec('CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES (\'preserved\'); PRAGMA user_version = 99')
    expect(() => new SqliteStore(path)).toThrow('unsupported database schema')
    expect(db.pragma('user_version', { simple: true })).toBe(99)
    expect(db.prepare('SELECT * FROM sentinel').all()).toEqual([{ value: 'preserved' }])
  })

  it('refuses an unknown nonempty database with version zero', () => {
    const path = databasePath()
    const db = raw(path)
    db.exec('CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES (\'preserved\')')
    expect(() => new SqliteStore(path)).toThrow('unsupported database schema')
    expect(db.prepare('SELECT * FROM sentinel').all()).toEqual([{ value: 'preserved' }])
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })

  it('does not mistake user tables resembling SQLite internal names for an empty database', () => {
    const path = databasePath()
    const db = raw(path)
    db.exec('CREATE TABLE sqliteXsentinel (value TEXT)')
    expect(() => new SqliteStore(path)).toThrow('unsupported database schema')
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'works'").get()).toBeUndefined()
  })

  it('refuses damaged files safely without reporting their contents', () => {
    const path = databasePath()
    writeFileSync(path, 'PRIVATE_DATABASE_MARKER')
    expect(() => new SqliteStore(path)).toThrow('database could not be opened')
  })

  it('rejects invalid stored heads and config without leaking values', () => {
    const path = databasePath()
    const store = open(path)
    const work = store.createWork({ seed: 'x' })
    store.appendArtifact(work.id, 'caption', caption('ok'))
    const db = raw(path)
    db.prepare('UPDATE artifacts SET content = ?').run(JSON.stringify({ secret: 'PRIVATE_CONTENT_MARKER' }))
    expect(() => store.getWork(work.id)).toThrow('stored data violates its contract')
    expect(() => store.listWorks()).toThrow('stored data violates its contract')
    expect(() => store.headVersion(work.id, 'caption')).toThrow('stored data violates its contract')
    db.prepare('UPDATE artifacts SET content = ?').run(JSON.stringify(caption('ok')))
    db.prepare('UPDATE works SET config = ?').run(JSON.stringify({ secret: 'PRIVATE_CONFIG_MARKER' }))
    expect(() => store.getWork(work.id)).toThrow('stored data violates its contract')
  })

  it('uses private new files and WAL without changing existing permissions', () => {
    const path = databasePath()
    open(path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const db = raw(path)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    chmodSync(path, 0o640)
    open(path)
    expect(statSync(path).mode & 0o777).toBe(0o640)
  })

  it('rejects a version-one database whose schema no longer matches', () => {
    const path = databasePath()
    open(path).close()
    const db = raw(path)
    db.exec('DROP INDEX artifact_work_version')
    expect(() => new SqliteStore(path)).toThrow('unsupported database schema')
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'artifact_work_version'").get()).toBeUndefined()
  })

  it('enforces work/chapter addresses, NULL uniqueness, positive versions and JSON at the SQL boundary', () => {
    const path = databasePath()
    const store = open(path)
    const work = store.createWork({ seed: 'x' })
    store.appendArtifact(work.id, 'caption', caption('one'))
    const db = raw(path)
    const insert = db.prepare('INSERT INTO artifacts (id, work_id, kind, chapter, version, content, human_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    expect(() => insert.run('duplicate', work.id, 'caption', null, 1, '{}', 'pending', 'today')).toThrow()
    expect(() => insert.run('null-chapter', work.id, 'beat', null, 1, '{}', 'pending', 'today')).toThrow()
    expect(() => insert.run('bad-work-address', work.id, 'caption', 1, 2, '{}', 'pending', 'today')).toThrow()
    expect(() => insert.run('bad-version', work.id, 'caption', null, 0, '{}', 'pending', 'today')).toThrow()
    expect(() => insert.run('bad-json', work.id, 'caption', null, 2, '{', 'pending', 'today')).toThrow()
    expect(() => insert.run('foreign-work', 'missing', 'caption', null, 1, '{}', 'pending', 'today')).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 1 })
  })

  it('compares targets, statuses and upstreams inside each connection write transaction', () => {
    const path = databasePath()
    const first = open(path)
    const second = open(path)
    const work = first.createWork({ seed: 'x' })
    const original = first.appendArtifact(work.id, 'prose', { text: 'original' }, { chapter: 1 })
    const request = { workId: work.id, kind: 'prose' as const, chapter: 1, expectedArtifactId: original.id, expectedHeadVersion: 1, expectedHumanStatus: 'pending' as const, content: { text: 'edited' } }
    const latest = second.saveArtifact(request)
    expect(() => first.saveArtifact(request)).toThrow(expect.objectContaining({ code: 'version-conflict' }))
    const pending = first.appendArtifact(work.id, 'setting', setting('candidate'))
    expect(() => second.finalizeArtifact({ workId: work.id, kind: 'setting', expectedArtifactId: pending.id, expectedHeadVersion: 1, content: pending.content, preconditions: [{ kind: 'prose', chapter: 1, head: { artifactId: original.id, version: 1, humanStatus: 'pending' } }] })).toThrow(expect.objectContaining({ code: 'upstream-changed' }))
    const approved = first.finalizeArtifact({ ...request, expectedArtifactId: latest.id, expectedHeadVersion: 2, content: latest.content })
    expect(() => second.saveArtifact({ ...request, expectedArtifactId: latest.id, expectedHeadVersion: 2 })).toThrow(expect.objectContaining({ code: 'version-conflict' }))
    expect(second.getWork(work.id)!.artifacts).toEqual([approved, pending])
    expect(raw(path).prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 3 })
  })

  it('initializes samples atomically and only on an empty bookshelf across connections', () => {
    const path = databasePath()
    const first = open(path)
    const second = open(path)
    expect(() => first.createWorksIfEmpty([{ seed: 'valid' }, { seed: '' }])).toThrow('store input violates its contract')
    expect(first.listWorks()).toEqual([])
    expect(second.createWorksIfEmpty([{ seed: 'one' }, { seed: 'two' }])).toBe(true)
    const before = first.listWorks()
    expect(first.createWorksIfEmpty([{ seed: 'never added' }])).toBe(false)
    expect(second.listWorks()).toEqual(before)
  })

  it('rolls back a multi-row bootstrap when SQL rejects a later insertion', () => {
    const path = databasePath()
    const store = open(path)
    const db = raw(path)
    db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON works WHEN NEW.seed = 'reject' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    expect(() => store.createWorksIfEmpty([{ seed: 'first' }, { seed: 'reject' }])).toThrow()
    expect(store.listWorks()).toEqual([])
    db.exec('DROP TRIGGER fail_second')
    expect(store.createWorksIfEmpty([{ seed: 'retry' }])).toBe(true)
  })

  it('lists all work summaries with a constant number of SQL statements', () => {
    const path = databasePath()
    const store = open(path)
    const prepare = vi.spyOn(Database.prototype, 'prepare')
    const first = store.createWork({ seed: 'first', title: 'First' })
    const second = store.createWork({ seed: 'second', title: 'Second' })
    store.appendArtifact(first.id, 'caption', caption('first'))
    store.appendArtifact(second.id, 'caption', caption('second'))
    prepare.mockClear()

    expect(store.listWorks()).toEqual([
      { id: first.id, title: 'First', seedPreview: 'first', chapterCount: 0 },
      { id: second.id, title: 'Second', seedPreview: 'second', chapterCount: 0 },
    ])
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('uses the full work/head index in both batched artifact read queries', () => {
    const path = databasePath()
    const store = open(path)
    const work = store.createWork({ seed: 'x' })
    store.appendArtifact(work.id, 'caption', caption('head'))
    const prepare = vi.spyOn(Database.prototype, 'prepare')
    expect(store.getWork(work.id)).toBeDefined()
    expect(store.listWorks()).toHaveLength(1)
    const queries = [...new Set(prepare.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('SELECT a.* FROM artifacts a')))]
    expect(queries).toHaveLength(2)
    const db = raw(path)
    for (const query of queries) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...(query.includes('a.work_id = ?') ? [work.id] : [])) as { detail: string }[]
      const newer = plan.find(row => row.detail.includes('newer'))
      expect(newer?.detail).toContain('COVERING INDEX artifact_work_head')
      for (const column of ['work_id', 'kind', 'chapter', 'version']) expect(newer?.detail).toContain(column)
      if (query.includes('ORDER BY')) {
        expect(plan.find(row => row.detail.includes('SEARCH a USING INDEX artifact_work_head'))).toBeDefined()
        expect(plan.find(row => row.detail.startsWith('SEARCH first USING') && row.detail.includes('artifact_work_head'))).toBeDefined()
      }
    }
    const filePlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM agent_files WHERE work_id = ? ORDER BY rowid').all(work.id) as { detail: string }[]
    expect(filePlan.some(row => row.detail.includes('SEARCH agent_files USING INDEX agent_file_work'))).toBe(true)
  })

  it('keeps legitimate works while ignoring a damaged orphan artifact', () => {
    const path = databasePath()
    const store = open(path)
    const orphan = store.createWork({ seed: 'orphan' })
    store.appendArtifact(orphan.id, 'caption', caption('orphan'))
    const kept = store.createWork({ seed: 'legitimate remains', title: 'kept' })
    store.appendArtifact(kept.id, 'caption', caption('safe'))
    const db = raw(path)
    db.exec('PRAGMA foreign_keys = OFF')
    db.prepare('DELETE FROM works WHERE id = ?').run(orphan.id)
    db.prepare("UPDATE artifacts SET content = '{\"broken\":true}' WHERE work_id = ?").run(orphan.id)
    expect(store.listWorks()).toEqual([{ id: kept.id, title: 'kept', seedPreview: 'legitimate remains', chapterCount: 0 }])
  })
})
