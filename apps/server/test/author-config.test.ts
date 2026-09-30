import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { SqliteStore } from '../src/store/sqlite-store.js'
import { createProductionApp } from '../src/runtime/production-app.js'
import { AuthorConfigService } from '../src/config/author-config-service.js'
import { agentFileSchema, authorConfigViewSchema, advanceOutcomeDtoSchema } from '@agent4novel/contracts'

const configView = async (response: Response) => authorConfigViewSchema.parse(await response.json())

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'a4n-config-')); dirs.push(dir)
  const store = new SqliteStore(join(dir, 'agent4novel.sqlite'))
  const work = store.createWork({ seed: 'configuration fixture' })
  const { app } = createProductionApp(store, undefined, dir)
  const url = `/api/works/${work.id}/agent-config`
  return { dir, store, work, app, url }
}
const document = { preferences: { style: 'plain', genre: 'fantasy', payoff: 'growth' }, defaults: { temperature: 0.2 }, steps: { prose: { temperature: 0.7 } } }
describe('author configuration at the production boundary', () => {
  it('uses legacy Work.config only until the first author revision is saved', () => {
    const f = fixture()
    try {
      const raw = new Database(join(f.dir, 'agent4novel.sqlite'))
      try { raw.prepare('UPDATE works SET config = ? WHERE id = ?').run(JSON.stringify({ temperature: 0.7, directionCount: 3, systemPrompt: 'LEGACY_GUIDANCE' }), f.work.id) } finally { raw.close() }
      const service = new AuthorConfigService(f.store, f.store, f.dir)
      expect(service.get(f.work.id).effective[0]!.generation.temperature).toBe(0.7)
      service.save(f.work.id, { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: {}, steps: {} } })
      const after = service.get(f.work.id)
      expect(after.revision).toBe(1)
      expect(after.effective[0]!.generation.temperature).not.toBe(0.7)
      expect(after.effective[0]!.directionCount).toBe(2)
      expect(service.snapshot(f.store.getWork(f.work.id)!).caption!.systemPrompt).not.toContain('LEGACY_GUIDANCE')
    } finally { f.store.close() }
  })
  it('rejects the assembled system budget before saving or generating any artifact', async () => {
    const f = fixture()
    try {
      const service = new AuthorConfigService(f.store, f.store, f.dir)
      const skills = [1, 2].map(n => service.upload(f.work.id, { requestId: randomUUID(), kind: 'skill', text: `---\nname: budget-${n}\ndescription: Bounded individual file\n---\n${'a'.repeat(25_000)}` }).id)
      const request = { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: { skills }, steps: {} } }
      expect(() => service.save(f.work.id, request)).toThrow('invalid author configuration')
      expect(f.store.getAuthorConfig(f.work.id)).toBeUndefined()
      // A damaged historical configuration must also fail at the generation boundary.
      f.store.saveAuthorConfig(f.work.id, request)
      const outcome = advanceOutcomeDtoSchema.parse(await (await f.app.request(`/api/works/${f.work.id}/advance`, { method: 'POST' })).json())
      expect(outcome.kind).toBe('failed')
      expect(outcome.telemetry).toEqual([])
      expect(f.store.getWork(f.work.id)!.artifacts).toEqual([])
    } finally { f.store.close() }
  })
  it('migrates the exact v1 schema without altering old works or artifacts', () => {
    const f = fixture()
    try {
      f.store.appendArtifact(f.work.id, 'prose', { text: 'saved old prose' }, { chapter: 1 })
      const before = f.store.getWork(f.work.id)
      f.store.close()
      const raw = new Database(join(f.dir, 'agent4novel.sqlite'))
      raw.exec('DROP INDEX bad_example_work_chapter; DROP TABLE bad_examples; DROP TABLE author_configs; DROP TABLE agent_files; PRAGMA user_version = 1'); raw.close()
      const reopened = new SqliteStore(join(f.dir, 'agent4novel.sqlite'))
      try {
        expect(reopened.getWork(f.work.id)).toEqual(before)
        expect(reopened.getAuthorConfig(f.work.id)).toBeUndefined()
        reopened.saveAuthorConfig(f.work.id, { requestId: randomUUID(), expectedRevision: 0, document })
        const db = new Database(join(f.dir, 'agent4novel.sqlite'), { readonly: true })
        try { expect(db.pragma('user_version', { simple: true })).toBe(3) } finally { db.close() }
      } finally { reopened.close() }
    } finally { f.store.close() }
  })
  it('uses CAS across connections and returns an old idempotent receipt after newer saves', () => {
    const f = fixture(), other = new SqliteStore(join(f.dir, 'agent4novel.sqlite'))
    try {
      const request = { requestId: randomUUID(), expectedRevision: 0, document }
      const first = f.store.saveAuthorConfig(f.work.id, request)
      expect(() => other.saveAuthorConfig(f.work.id, { ...request, requestId: randomUUID() })).toThrow('configuration revision changed')
      other.saveAuthorConfig(f.work.id, { requestId: randomUUID(), expectedRevision: 1, document: { ...document, preferences: {} } })
      expect(f.store.saveAuthorConfig(f.work.id, request)).toEqual(first)
      expect(f.store.getAuthorConfig(f.work.id)?.revision).toBe(2)
    } finally { other.close(); f.store.close() }
  })
  it('rejects cross-work or changed files and never stores prompt text in SQLite', async () => {
    const f = fixture()
    try {
      const text = 'PRIVATE_FILE_BODY_SENTINEL'
      const result = await f.app.request(`/api/works/${f.work.id}/agent-files`, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), kind: 'prompt', text }), headers: { 'content-type': 'application/json' } })
      const file = agentFileSchema.parse(await result.json())
      const other = f.store.createWork({ seed: 'other' })
      const put = (workId: string) => f.app.request(`/api/works/${workId}/agent-config`, { method: 'PUT', body: JSON.stringify({ requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: { systemPromptRef: file.id }, steps: {} } }), headers: { 'content-type': 'application/json' } })
      expect((await put(other.id)).status).toBe(400)
      const frozen = { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: { systemPromptRef: file.id }, steps: {} } }
      const save = () => f.app.request(f.url, { method: 'PUT', body: JSON.stringify(frozen), headers: { 'content-type': 'application/json' } })
      const receipt = await (await save()).json()
      f.store.saveAuthorConfig(f.work.id, { requestId: randomUUID(), expectedRevision: 1, document: { preferences: {}, defaults: {}, steps: {} } })
      const db = new Database(join(f.dir, 'agent4novel.sqlite'), { readonly: true })
      try { expect(JSON.stringify(db.prepare('SELECT * FROM agent_files').all())).not.toContain(text) } finally { db.close() }
      const bucket = createHash('sha256').update(f.work.id).digest('hex')
      writeFileSync(join(f.dir, 'prompts', bucket, file.id, file.name, 'SKILL.md'), 'tampered')
      expect((await put(f.work.id)).status).toBe(404)
      const replay = await save()
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(receipt)
      expect((await configView(await f.app.request(f.url))).revision).toBe(2)
    } finally { f.store.close() }
  })
  it('rejects invalid UTF-8 JSON and enforces the actual HTTP body budget', async () => {
    const f = fixture()
    try {
      const endpoint = `/api/works/${f.work.id}/agent-files`
      const invalidUtf8 = Buffer.from(JSON.stringify({ requestId: randomUUID(), kind: 'prompt', text: 'UTF8_MARKER' }))
      invalidUtf8[invalidUtf8.indexOf('UTF8_MARKER')] = 255
      expect((await f.app.request(endpoint, { method: 'POST', body: invalidUtf8, headers: { 'content-type': 'application/json' } })).status).toBe(400)
      expect((await f.app.request(endpoint, { method: 'POST', body: 'x'.repeat(196609), headers: { 'content-type': 'application/json' } })).status).toBe(413)
    } finally { f.store.close() }
  })
  it('rejects symlinked managed directories before creating anything outside the data directory', async () => {
    const f = fixture(), outside = mkdtempSync(join(tmpdir(), 'a4n-config-outside-')); dirs.push(outside)
    try {
      symlinkSync(outside, join(f.dir, 'prompts'), 'dir')
      const result = await f.app.request(`/api/works/${f.work.id}/agent-files`, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), kind: 'prompt', text: 'test guidance' }), headers: { 'content-type': 'application/json' } })
      expect(result.status).toBe(404)
      expect(readdirSync(outside)).toEqual([])
    } finally { f.store.close() }
  })
  it('uploads an immutable Skill, selects it and reads the same file after restart', async () => {
    const f = fixture()
    try {
      const request = { requestId: randomUUID(), kind: 'skill', text: '---\nname: plain-writing\ndescription: Short sentences\n---\nAvoid unnecessary repetition.' }
      const upload = (body: unknown) => f.app.request(`/api/works/${f.work.id}/agent-files`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
      const response = await upload(request)
      expect(response.status).toBe(200)
      const file = agentFileSchema.parse(await response.json())
      expect(file).toMatchObject({ id: request.requestId, workId: f.work.id, kind: 'skill', name: 'plain-writing' })
      expect(await (await upload(request)).json()).toEqual(file)
      expect((await upload({ ...request, text: request.text + ' changed' })).status).toBe(409)
      const save = { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: { skills: [file.id] }, steps: { caption: { skills: [] } } } }
      expect((await f.app.request(f.url, { method: 'PUT', body: JSON.stringify(save), headers: { 'content-type': 'application/json' } })).status).toBe(200)
      const view = await configView(await f.app.request(f.url))
      expect(view.effective.find((s: { id: string }) => s.id === 'caption')!.skills).toEqual([])
      expect(view.effective.find((s: { id: string }) => s.id === 'prose')!.skills).toEqual([file])
      f.store.close()
      const reopened = new SqliteStore(join(f.dir, 'agent4novel.sqlite'))
      try {
        const app = createProductionApp(reopened, undefined, f.dir).app
        expect(await (await app.request(`/api/works/${f.work.id}/agent-files/${file.id}`)).json()).toEqual({ file, text: request.text })
      } finally { reopened.close() }
    } finally { f.store.close() }
  })
  it.each(['---\nname: Bad Name\ndescription: text\n---\nbody', '---\nname: good\nname: duplicate\ndescription: text\n---\nbody', '---\nname: good\ndescription: &a text\nmetadata: {x: *a}\n---\nbody', '---\nname: good\n---\nbody', 'x'.repeat(32769)])('rejects unsafe or oversized files without replacing selected content', async text => {
    const f = fixture()
    try {
      const response = await f.app.request(`/api/works/${f.work.id}/agent-files`, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), kind: 'skill', text }), headers: { 'content-type': 'application/json' } })
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).not.toContain(text.slice(0, 50))
      expect((await configView(await f.app.request(f.url))).files).toEqual([])
    } finally { f.store.close() }
  })
  it('persists defaults and overrides without changing any work or artifact', async () => {
    const f = fixture()
    try {
      const before = f.store.getWork(f.work.id)
      const initial = await f.app.request(f.url)
      expect(initial.status).toBe(200)
      expect((await configView(initial)).revision).toBe(0)
      const request = { requestId: randomUUID(), expectedRevision: 0, document }
      const saved = await f.app.request(f.url, { method: 'PUT', body: JSON.stringify(request), headers: { 'content-type': 'application/json' } })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toMatchObject({ workId: f.work.id, revision: 1, requestId: request.requestId, document })
      const view = await configView(await f.app.request(f.url))
      expect(view.effective.find((s: { id: string }) => s.id === 'prose')).toMatchObject({ generation: { temperature: 0.7 }, appliedPreferences: document.preferences })
      expect(view.effective.find((s: { id: string }) => s.id === 'caption')!.appliedPreferences).toEqual({})
      expect(f.store.getWork(f.work.id)).toEqual(before)
      f.store.close()
      const reopened = new SqliteStore(join(f.dir, 'agent4novel.sqlite'))
      try {
        const again = createProductionApp(reopened, undefined, f.dir).app
        expect((await configView(await again.request(f.url))).document).toEqual(document)
      } finally { reopened.close() }
    } finally { f.store.close() }
  })
  it('freezes request identity, rejects a stale revision and refuses enabled tools', async () => {
    const f = fixture()
    try {
      const request = { requestId: randomUUID(), expectedRevision: 0, document }
      const put = (body: unknown) => f.app.request(f.url, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
      const first = await (await put(request)).json()
      expect(await (await put(request)).json()).toEqual(first)
      expect((await put({ ...request, document: { ...document, preferences: {} } })).status).toBe(409)
      expect((await put({ ...request, requestId: randomUUID() })).status).toBe(409)
      expect((await put({ requestId: randomUUID(), expectedRevision: 1, document: { ...document, defaults: { tools: ['shell'] } } })).status).toBe(400)
      expect((await configView(await f.app.request(f.url))).revision).toBe(1)
    } finally { f.store.close() }
  })
})
