import { describe, expect, it } from 'vitest'
import { artifactKinds, artifactSchema, workDetailSchema, workViewSchema } from '../src/index.js'

const envelope = { id: 'artifact-1', workId: 'work-1', version: 1, humanStatus: 'pending' as const, createdAt: 'today' }
const work = { id: 'work-1', title: '故事', seed: '故事', config: {}, createdAt: 'today' }

describe('shared artifact validation boundary', () => {
  it.each(artifactKinds)('rejects malformed %s content at artifact, stored work and public work boundaries', kind => {
    const artifact = { ...envelope, kind, content: {}, ...(['beat', 'prose'].includes(kind) ? { chapter: 2 } : {}) }
    expect(artifactSchema.safeParse(artifact).success).toBe(false)
    expect(workDetailSchema.safeParse({ ...work, artifacts: [artifact] }).success).toBe(false)
    expect(workViewSchema.safeParse({ ...work, artifacts: [artifact], workflowState: 'ready-to-generate', allowedActions: [], nextStepId: null }).success).toBe(false)
  })
  it('keeps pending prose edits saveable but rejects empty approved prose', () => {
    const artifact = { ...envelope, kind: 'prose', chapter: 2, content: { text: '  \n' } }
    expect(artifactSchema.parse(artifact)).toEqual(artifact)
    expect(artifactSchema.safeParse({ ...artifact, humanStatus: 'approved' }).success).toBe(false)
    expect(artifactSchema.parse({ ...artifact, humanStatus: 'approved', content: { text: '  保留作者空白\n' } }).content).toEqual({ text: '  保留作者空白\n' })
  })
  it('rejects a corrupt stored snapshot with a foreign artifact or duplicate current head', () => {
    const artifact = { ...envelope, kind: 'prose', chapter: 2, content: { text: '正文' } }
    expect(workDetailSchema.safeParse({ ...work, artifacts: [artifact] }).success).toBe(true)
    expect(workDetailSchema.safeParse({ ...work, artifacts: [{ ...artifact, workId: 'another-work' }] }).success).toBe(false)
    expect(workDetailSchema.safeParse({ ...work, artifacts: [artifact, { ...artifact, id: 'duplicate', version: 2 }] }).success).toBe(false)
  })
})
