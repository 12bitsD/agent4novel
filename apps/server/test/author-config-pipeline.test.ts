import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { AgentConfig } from '@agent4novel/contracts'
import { SqliteStore } from '../src/store/sqlite-store.js'
import { AuthorConfigService } from '../src/config/author-config-service.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep } from '../src/steps/fake-step.js'

describe('operation configuration snapshot', () => {
  it('keeps already read file text during an operation and rejects a changed file before the next call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a4n-config-file-snapshot-')), store = new SqliteStore(join(dir, 'db.sqlite'))
    try {
      const work = store.createWork({ seed: 'file snapshot' }), service = new AuthorConfigService(store, store, dir)
      const file = service.upload(work.id, { requestId: randomUUID(), kind: 'prompt', text: 'original author guidance' })
      service.save(work.id, { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: { systemPromptRef: file.id }, steps: {} } })
      const seen: AgentConfig[] = [], caption = createFakeCaptionStep(), creative = createFakeCreativeStep(), outline = createFakeOutlineStep()
      const captionRun = caption.run.bind(caption), creativeRun = creative.run.bind(creative)
      caption.run = async (input, config) => {
        seen.push(config)
        writeFileSync(join(dir, 'prompts', createHash('sha256').update(work.id).digest('hex'), file.id, file.name, 'SKILL.md'), 'changed file')
        return captionRun(input, config)
      }
      creative.run = async (input, config) => { seen.push(config); return creativeRun(input, config) }
      outline.run = async () => { throw new Error('must not call the step after tampering') }
      const pipeline = new Pipeline({ store, steps: new Map([['caption', caption], ['creative', creative], ['outline', outline]]),
        definition: [{ stepId: 'caption', outputKind: 'caption' }, { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } }, { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } }],
        resolveConfig: (work, id) => service.snapshot(work)[id]!, snapshotConfig: work => service.snapshot(work) })
      expect((await pipeline.advance(work.id)).kind).toBe('advanced')
      expect(seen.map(config => config.systemPrompt)).toEqual(['original author guidance', 'original author guidance'])
      pipeline.approve(work.id, 'creative')
      expect((await pipeline.advance(work.id)).kind).toBe('failed')
      expect(store.getWork(work.id)!.artifacts.some(a => a.kind === 'outline')).toBe(false)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
  it('keeps one revision across an advance and uses the new revision on the next operation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a4n-config-pipeline-'))
    const store = new SqliteStore(join(dir, 'db.sqlite'))
    try {
      const work = store.createWork({ seed: 'snapshot fixture' })
      const service = new AuthorConfigService(store, store, dir)
      const doc = { preferences: {}, defaults: { temperature: 0.2, directionCount: 1 }, steps: {} }
      service.save(work.id, { requestId: randomUUID(), expectedRevision: 0, document: doc })
      const seen: AgentConfig[] = []
      const caption = createFakeCaptionStep(), creative = createFakeCreativeStep(), outline = createFakeOutlineStep()
      const captionRun = caption.run.bind(caption), creativeRun = creative.run.bind(creative), outlineRun = outline.run.bind(outline)
      caption.run = async (input, config) => {
        seen.push(structuredClone(config))
        service.save(work.id, { requestId: randomUUID(), expectedRevision: 1, document: { ...doc, defaults: { ...doc.defaults, temperature: 0.8 } } })
        return captionRun(input, config)
      }
      creative.run = async (input, config) => { seen.push(structuredClone(config)); return creativeRun(input, config) }
      outline.run = async (input, config) => { seen.push(structuredClone(config)); return outlineRun(input, config) }
      const pipeline = new Pipeline({ store, steps: new Map([['caption', caption], ['creative', creative], ['outline', outline]]),
        definition: [{ stepId: 'caption', outputKind: 'caption' }, { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
          { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } }],
        resolveConfig: (work, stepId) => service.snapshot(work)[stepId]!, snapshotConfig: work => service.snapshot(work),
      })
      expect((await pipeline.advance(work.id)).kind).toBe('advanced')
      expect(seen.map(config => [config.configRevision, config.temperature])).toEqual([[1, 0.2], [1, 0.2]])
      pipeline.approve(work.id, 'creative')
      expect((await pipeline.advance(work.id)).kind).toBe('advanced')
      expect(seen.at(-1)).toMatchObject({ configRevision: 2, temperature: 0.8 })
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
