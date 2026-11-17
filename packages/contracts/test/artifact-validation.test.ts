import { describe, expect, it } from 'vitest'
import { artifactKinds, artifactSchema, workDetailSchema, workViewSchema } from '../src/index.js'

const envelope = { id: 'artifact-1', workId: 'work-1', version: 1, humanStatus: 'pending' as const, createdAt: 'today' }
const work = { id: 'work-1', title: '故事', seed: '故事', config: {}, createdAt: 'today' }
const workView = { ...work, workflowState: 'ready-to-generate', allowedActions: [], nextStepId: null }

describe('shared artifact validation boundary', () => {
  it.each(artifactKinds)('rejects malformed %s content at artifact, stored work and public work boundaries', kind => {
    const artifact = { ...envelope, kind, content: {}, ...(['beat', 'prose'].includes(kind) ? { chapter: 2 } : {}) }
    expect(artifactSchema.safeParse(artifact).success).toBe(false)
    expect(workDetailSchema.safeParse({ ...work, artifacts: [artifact] }).success).toBe(false)
    expect(workViewSchema.safeParse({ ...workView, artifacts: [artifact] }).success).toBe(false)
    if (kind === 'beat') {
      expect(workViewSchema.safeParse({ ...workView, artifacts: [{ ...artifact, content: { title: 'partial' } }] }).success).toBe(false)
    }
  })
  it('keeps pending prose edits saveable but rejects empty approved prose', () => {
    const artifact = { ...envelope, kind: 'prose', chapter: 2, content: { text: '  \n' } }
    expect(artifactSchema.parse(artifact)).toEqual(artifact)
    expect(artifactSchema.safeParse({ ...artifact, humanStatus: 'approved' }).success).toBe(false)
    expect(artifactSchema.parse({ ...artifact, humanStatus: 'approved', content: { text: '  保留作者空白\n' } }).content).toEqual({ text: '  保留作者空白\n' })
  })
  it('rejects foreign artifacts and duplicate current heads at stored and public work boundaries', () => {
    const prose = { ...envelope, kind: 'prose', chapter: 2, content: { text: '正文' } }
    expect(workDetailSchema.safeParse({ ...work, artifacts: [prose] }).success).toBe(true)
    expect(workDetailSchema.safeParse({ ...work, artifacts: [{ ...prose, workId: 'another-work' }] }).success).toBe(false)
    expect(workDetailSchema.safeParse({ ...work, artifacts: [prose, { ...prose, id: 'duplicate', version: 2 }] }).success).toBe(false)

    const caption = { ...envelope, id: 'caption-1', kind: 'caption', humanStatus: 'approved', content: { inputStage: '脑洞', summary: '海港故事', elements: [], gaps: [] } }
    expect(workViewSchema.safeParse({ ...workView, artifacts: [caption] }).success).toBe(true)
    const foreign = workViewSchema.safeParse({ ...workView, artifacts: [{ ...caption, workId: 'another-work' }] })
    expect(foreign.success).toBe(false)
    if (!foreign.success) expect(foreign.error.issues.map(issue => issue.path)).toContainEqual(['artifacts', 0, 'workId'])
    const duplicateCaption = workViewSchema.safeParse({ ...workView, artifacts: [caption, { ...caption, id: 'caption-2', version: 2 }] })
    expect(duplicateCaption.success).toBe(false)
    if (!duplicateCaption.success) expect(duplicateCaption.error.issues.map(issue => issue.path)).toContainEqual(['artifacts', 1])

    const beat = { ...envelope, id: 'beat-1', kind: 'beat', chapter: 1, content: { title: '海港来客', goal: '发现来客', writingPlan: [{ itemId: 'item-1', title: '靠岸', content: '来客靠岸。' }], ending: '来客叩门。' } }
    expect(workViewSchema.safeParse({ ...workView, artifacts: [beat, { ...beat, id: 'beat-2', version: 2 }] }).success).toBe(false)
    expect(workViewSchema.safeParse({ ...workView, artifacts: [caption, beat, { ...beat, id: 'beat-chapter-2', chapter: 2 }, { ...prose, id: 'prose-1', chapter: 1 }] }).success).toBe(true)
  })
})
