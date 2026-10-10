import { describe, expect, it } from 'vitest'
import { beatContentSchema, proseContentSchema, settingContentSchema, settingExtensionReceiptSchema, settingExtensionResourceSchema } from '@agent4novel/contracts'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { SqliteStore } from '../src/store/sqlite-store.js'
import { Pipeline, type ArtifactStep, type PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { fakeArtifactStep } from './fakes.js'
import { approveSetting } from '../src/setting-review.js'
import { approveBeat } from '../src/beat-review.js'
import { approveProse } from '../src/prose-review.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

const headers = { 'Content-Type': 'application/json' }
const baseSetting = {
  overview: '雾中小镇的道路会随钟声改变。',
  world: [{ itemId: 'world-1', title: '小镇', content: '镇中心有一口旧钟。' }],
  characters: [{ itemId: 'character-1', title: '旅人', content: '旅人寻找自己的名字。' }],
  factions: [], relationships: [], extensions: [],
}
const caption = { inputStage: '脑洞', summary: '提炼稿', elements: [{ kind: '设定', content: '雾城' }], gaps: [] }
const creative = { directions: [{ directionId: 'd1', title: '方向', hook: '钩子', tags: [], synopsis: '故事', characters: [], setting: [], payoffs: [], outline: [] }] }
const outline = { arcs: [1, 2, 3].map(i => ({ arcId: `a${i}`, title: '寻找', conflict: '失忆', development: '调查', resolution: '找回', segments: [1, 2].map(j => ({ segmentId: `s${i}-${j}`, title: '钟楼', summary: '调查', outcome: '线索' })) })) }

function fixture(store: InMemoryStore | SqliteStore = new InMemoryStore()) {
  const work = store.createWork({ seed: '雾中小镇' })
  for (const [kind, content] of [['caption', caption], ['creative', creative], ['outline', outline]] as const) {
    store.appendArtifact(work.id, kind, content)
    store.setStatus(work.id, kind, 'approved')
  }
  const pending = store.appendArtifact(work.id, 'setting', baseSetting)
  approveSetting(store, work.id, { content: baseSetting, expectedHeadVersion: pending.version })
  const definition: PipelineDefinitionEntry[] = [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
    { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
  ]
  const steps = new Map<string, ArtifactStep>(definition.map(entry => [entry.stepId, fakeArtifactStep(entry.stepId, baseSetting).step]))
  const pipeline = new Pipeline({ store, steps, definition, consumeGuards, resolveConfig: () => ({}) })
  return { store, work, app: createApp({ store, pipeline, meta: { demo: true } }), base: { artifactId: pending.id, version: pending.version } }
}

const requestId = '22222222-2222-4222-8222-222222222222'
function proposal(base: { artifactId: string; version: number }, id = requestId) {
  return { requestId: id, expectedBase: base, extension: { title: '补充规则', items: [{ title: '潮汐', content: '潮汐每天改变一次。' }] } }
}

const beat = { title: '钟楼', goal: '找到线索', writingPlan: [{ itemId: 'plan-1', title: '调查', content: '询问守钟人。' }], ending: '得到线索。' }
const prose = { text: '旅人走进钟楼，听见了改变道路的钟声。' }

async function chapterFixture() {
  const store = new InMemoryStore()
  const work = store.createWork({ seed: '雾中小镇' })
  for (const [kind, content] of [['caption', caption], ['creative', creative], ['outline', outline]] as const) {
    store.appendArtifact(work.id, kind, content)
    store.setStatus(work.id, kind, 'approved')
  }
  const pendingSetting = store.appendArtifact(work.id, 'setting', baseSetting)
  approveSetting(store, work.id, { content: baseSetting, expectedHeadVersion: pendingSetting.version })
  const definition: PipelineDefinitionEntry[] = [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
    { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
    { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
    { stepId: 'prose', outputKind: 'prose', chapter: 1, consumes: ['beat', 'setting'], gateAfter: { kind: 'prose', chapter: 1 } },
  ]
  const steps = new Map<string, ArtifactStep>([
    ['caption', fakeArtifactStep('caption', caption).step], ['creative', fakeArtifactStep('creative', creative).step],
    ['outline', fakeArtifactStep('outline', outline).step], ['setting', fakeArtifactStep('setting', baseSetting).step],
    ['beat', fakeArtifactStep('beat', beat).step], ['prose', fakeArtifactStep('prose', prose).step],
  ])
  const pipeline = new Pipeline({ store, steps, definition, repeatChapters: true, consumeGuards, resolveConfig: () => ({}) })
  await pipeline.advance(work.id)
  let current = store.getWork(work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 1)!
  await approveBeat(store, work.id, { chapter: 1, expectedArtifactId: current.id, expectedHeadVersion: current.version, content: beatContentSchema.parse(current.content) })
  await pipeline.advance(work.id)
  current = store.getWork(work.id)!.artifacts.find(a => a.kind === 'prose' && a.chapter === 1)!
  await approveProse(store, work.id, { chapter: 1, expectedArtifactId: current.id, expectedHeadVersion: current.version, content: proseContentSchema.parse(current.content) })
  return { store, work, pipeline, app: createApp({ store, pipeline, meta: { demo: true } }) }
}

describe('append-only setting extension', () => {
  it.each([['memory', () => new InMemoryStore()], ['sqlite', () => new SqliteStore(':memory:')]] as const)('proposes, approves and replays on %s', async (_name, makeStore) => {
    const f = fixture(makeStore())
    const proposed = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    expect(proposed.status).toBe(201)
    const receipt = settingExtensionReceiptSchema.parse(await proposed.json())
    expect(receipt).toMatchObject({ operation: 'propose', outcome: 'success', writeOutcome: 'committed', proposal: { workId: f.work.id, requestId } })
    const replay = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    expect(await replay.json()).toEqual(receipt)
    const approved = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })
    expect(approved.status).toBe(200)
    const approval = settingExtensionReceiptSchema.parse(await approved.json())
    expect(approval).toMatchObject({ operation: 'approve', outcome: 'success', writeOutcome: 'committed' })
    expect(approval.candidate).toEqual(expect.objectContaining({ version: 2 }))
    const content = settingContentSchema.parse(f.store.getWork(f.work.id)!.artifacts.find(a => a.kind === 'setting')!.content)
    expect(content.extensions).toHaveLength(1)
    expect(content.overview).toBe(baseSetting.overview)
    const approveReplay = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })
    expect(await approveReplay.json()).toEqual(approval)
    const terminalProposeReplay = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    expect(terminalProposeReplay.status).toBe(201)
    expect(await terminalProposeReplay.json()).toEqual(receipt)
  })

  it.each([['memory', () => new InMemoryStore()], ['sqlite', () => new SqliteStore(':memory:')]] as const)('keeps normalized proposal and canonical extension equal on %s', async (_name, makeStore) => {
    const f = fixture(makeStore())
    const spaced = { ...proposal(f.base), extension: { title: ' 补充规则 ', items: [{ title: ' 潮汐 ', content: ' 潮汐每天改变一次。 ' }] } }
    await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(spaced) })
    const pending = settingExtensionResourceSchema.parse(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json())
    expect(pending.status).toBe('pending')
    expect(pending.extension?.title).toBe('补充规则')
    await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })
    const approved = settingExtensionResourceSchema.parse(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json())
    const candidate = approved.candidate!
    const artifact = f.store.getArtifactVersion(f.work.id, 'setting', undefined, candidate.artifactId, candidate.version)!
    expect(settingContentSchema.parse(artifact.content).extensions.at(-1)).toEqual(approved.extension)
  })

  it.each([['memory', () => new InMemoryStore()], ['sqlite', () => new SqliteStore(':memory:')]] as const)('keeps an approved historical candidate readable after a later Setting head on %s', async (_name, makeStore) => {
    const f = fixture(makeStore())
    await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    const firstApproval = settingExtensionReceiptSchema.parse(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })).json())
    const firstCandidate = firstApproval.candidate!
    const secondId = '55555555-5555-4555-8555-555555555555'
    const secondBase = { artifactId: firstCandidate.artifactId, version: firstCandidate.version }
    await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(secondBase, secondId)) })
    await f.app.request(`/api/works/${f.work.id}/setting-extensions/${secondId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId: secondId, expectedBase: secondBase }) })
    const firstResource = settingExtensionResourceSchema.parse(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json())
    expect(firstResource.status).toBe('approved')
    expect(firstResource.candidate).toEqual(firstCandidate)
  })

  it('returns a read-time stale resource and allows cancelling it without a Setting write', async () => {
    const f = fixture()
    await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    const secondId = '33333333-3333-4333-8333-333333333333'
    await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base, secondId)) })
    await f.app.request(`/api/works/${f.work.id}/setting-extensions/${secondId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId: secondId, expectedBase: f.base }) })
    const staleApprove = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })
    expect(staleApprove.status).toBe(409)
    expect(await staleApprove.json()).toMatchObject({ code: 'setting-extension-stale' })
    const resource = settingExtensionResourceSchema.parse(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json())
    expect(resource.status).toBe('stale')
    const cancelled = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/cancel`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })
    expect(cancelled.status).toBe(200)
    expect(settingExtensionReceiptSchema.parse(await cancelled.json()).operation).toBe('cancel')
    expect(f.store.getWork(f.work.id)!.artifacts.filter(a => a.kind === 'setting')).toHaveLength(1)
  })

  it('rejects a changed requestId body without adding a second proposal', async () => {
    const f = fixture()
    const first = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    expect(first.status).toBe(201)
    const changed = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify({ ...proposal(f.base), extension: { title: '不同', items: [{ title: '新', content: '新' }] } }) })
    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({ code: 'setting-extension-request-conflict' })
    expect(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json()).toMatchObject({ status: 'pending' })
  })

  it('validates action path UUID and body requestId before proposal lookup', async () => {
    const f = fixture()
    const unknown = '44444444-4444-4444-8444-444444444444'
    const mismatch = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${unknown}/approve`, {
      method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }),
    })
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toMatchObject({ code: 'invalid-input' })
    const malformed = await f.app.request(`/api/works/${f.work.id}/setting-extensions/not-a-uuid/approve`, {
      method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }),
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ code: 'invalid-input' })
  })

  it('rejects merged logical overflow and raw UTF-8 body overflow before any write', async () => {
    const f = fixture()
    const logical = { ...proposal(f.base), extension: { title: '大量补充', items: Array.from({ length: 255 }, (_, i) => ({ title: `卡片${i}`, content: '内容' })) } }
    const logicalResponse = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(logical) })
    expect(logicalResponse.status).toBe(422)
    expect(await logicalResponse.json()).toMatchObject({ code: 'setting-extension-limit' })
    const bodyResponse = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: ' '.repeat(2 * 1024 * 1024 + 1) })
    expect(bodyResponse.status).toBe(413)
    expect(await bodyResponse.json()).toMatchObject({ code: 'payload-too-large' })
    expect(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json()).toMatchObject({ status: 'none' })
  })

  it('atomically rejects a proposal when any current chapter head is pending', async () => {
    const f = fixture()
    f.store.appendArtifact(f.work.id, 'beat', { title: '待审章纲', goal: '内容', writingPlan: [{ itemId: 'plan-1', title: '安排', content: '内容' }], ending: '结束' }, { chapter: 1 })
    const response = await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'setting-extension-chapter-pending' })
    expect((await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).status).toBe(200)
    expect(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json()).toMatchObject({ status: 'none' })
  })

  it('rechecks the pending chapter guard after proposal creation before approval', async () => {
    const f = fixture()
    expect((await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(f.base)) })).status).toBe(201)
    f.store.appendArtifact(f.work.id, 'prose', { text: '待审正文' }, { chapter: 1 })
    const response = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: f.base }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'setting-extension-chapter-pending' })
    expect(await (await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)).json()).toMatchObject({ status: 'pending' })
    expect(f.store.getWork(f.work.id)!.artifacts.filter(a => a.kind === 'setting')).toHaveLength(1)
  })

  it('keeps old chapter refs and makes a real future chapter consume the new Setting head', async () => {
    const f = await chapterFixture()
    const oldSetting = f.store.getWork(f.work.id)!.artifacts.find(a => a.kind === 'setting')!
    const oldChapter = f.store.getWork(f.work.id)!.artifacts.find(a => a.kind === 'prose' && a.chapter === 1)!
    const base = { artifactId: oldSetting.id, version: oldSetting.version }
    await f.app.request(`/api/works/${f.work.id}/setting-extensions`, { method: 'POST', headers, body: JSON.stringify(proposal(base)) })
    const approved = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}/approve`, { method: 'POST', headers, body: JSON.stringify({ requestId, expectedBase: base }) })
    const candidate = settingExtensionReceiptSchema.parse(await approved.json()).candidate!
    const start = await f.pipeline.startChapter(f.work.id, { chapter: 2, expectedPreviousProseId: oldChapter.id, expectedPreviousProseVersion: oldChapter.version })
    expect(start.kind).toBe('advanced')
    const newBeat = f.store.getWork(f.work.id)!.artifacts.find(a => a.kind === 'beat' && a.chapter === 2)!
    expect(newBeat.inputs).toContainEqual({ kind: 'setting', artifactId: candidate.artifactId, version: candidate.version })
    expect(f.store.getArtifactVersion(f.work.id, 'prose', 1, oldChapter.id, oldChapter.version)!.inputs).toContainEqual({ kind: 'setting', artifactId: oldSetting.id, version: oldSetting.version })
  })

  it('restarts SQLite with pending proposal and migrates a v3 database to v4', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a4n-setting-extension-'))
    const path = join(dir, 'db.sqlite')
    try {
      const store = new SqliteStore(path)
      const f = fixture(store)
      store.proposeSettingExtension(f.work.id, proposal(f.base))
      store.close()
      const reopened = new SqliteStore(path)
      expect(reopened.getSettingExtension(f.work.id, requestId).status).toBe('pending')
      reopened.close()
      const raw = new Database(path)
      raw.exec('DROP TABLE setting_extension_proposals; PRAGMA user_version = 3')
      raw.close()
      const migrated = new SqliteStore(path)
      expect(migrated.getSettingExtension(f.work.id, requestId).status).toBe('none')
      const check = new Database(path)
      try { expect(check.pragma('user_version', { simple: true })).toBe(4) } finally { check.close() }
      migrated.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not expose a corrupted SQLite proposal record as a legal resource', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a4n-setting-extension-corrupt-'))
    const path = join(dir, 'db.sqlite')
    try {
      const store = new SqliteStore(path)
      const f = fixture(store)
      store.proposeSettingExtension(f.work.id, proposal(f.base))
      const raw = new Database(path)
      const stored = raw.prepare('SELECT record FROM setting_extension_proposals WHERE work_id = ? AND request_id = ?').get(f.work.id, requestId) as { record: string }
      const corrupted = JSON.parse(stored.record)
      corrupted.request.expectedBase = { artifactId: 'artifact-corrupt', version: 99 }
      raw.prepare('UPDATE setting_extension_proposals SET record = ? WHERE work_id = ? AND request_id = ?').run(JSON.stringify(corrupted), f.work.id, requestId)
      raw.close()
      const response = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ code: 'internal-error' })
      store.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not accept an approved SQLite proposal whose candidate is missing or mismatched', async () => {
    for (const mutation of ['missing', 'base-setting'] as const) {
      const dir = mkdtempSync(join(tmpdir(), `a4n-setting-extension-candidate-${mutation}-`))
      const path = join(dir, 'db.sqlite')
      try {
        const store = new SqliteStore(path)
        const f = fixture(store)
        store.proposeSettingExtension(f.work.id, proposal(f.base))
        const approved = store.approveSettingExtension(f.work.id, { requestId, expectedBase: f.base })
        const raw = new Database(path)
        const stored = raw.prepare('SELECT record FROM setting_extension_proposals WHERE work_id = ? AND request_id = ?').get(f.work.id, requestId) as { record: string }
        const corrupted = JSON.parse(stored.record)
        corrupted.candidate = mutation === 'missing' ? { artifactId: 'artifact-missing', version: 99 } : f.base
        raw.prepare('UPDATE setting_extension_proposals SET record = ? WHERE work_id = ? AND request_id = ?').run(JSON.stringify(corrupted), f.work.id, requestId)
        raw.close()
        expect(approved.candidate).not.toBeNull()
        const response = await f.app.request(`/api/works/${f.work.id}/setting-extensions/${requestId}`)
        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({ code: 'internal-error' })
        store.close()
      } finally { rmSync(dir, { recursive: true, force: true }) }
    }
  })

  it('rolls back both the canonical append and proposal status when SQLite commit fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a4n-setting-extension-rollback-'))
    const path = join(dir, 'db.sqlite')
    try {
      const store = new SqliteStore(path)
      const f = fixture(store)
      store.proposeSettingExtension(f.work.id, proposal(f.base))
      const raw = new Database(path)
      raw.exec("CREATE TRIGGER fail_setting_extension_insert BEFORE INSERT ON artifacts WHEN NEW.kind = 'setting' BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END")
      raw.close()
      expect(() => store.approveSettingExtension(f.work.id, { requestId, expectedBase: f.base })).toThrow()
      expect(store.getSettingExtension(f.work.id, requestId).status).toBe('pending')
      expect(store.getWork(f.work.id)!.artifacts.filter(a => a.kind === 'setting')).toHaveLength(1)
      store.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
