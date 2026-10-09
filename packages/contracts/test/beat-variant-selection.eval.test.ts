import { describe, expect, it } from 'vitest'
import { beatCommandResponseSchema, beatContentSchema, beatVariantSelectionRequestSchema, beatVariantSelectionResponseSchema } from '../src/index.js'

const original = {
  title: '旧章纲', goal: '守住线索',
  writingPlan: [{ itemId: 'beat-item-old', title: '问路', content: '主角向守门人问路。' }],
  ending: '拿到半张地图。',
}
const artifact = { id: 'beat-a', workId: 'work-1', kind: 'beat' as const, chapter: 1, version: 1, content: original, humanStatus: 'pending' as const, createdAt: '2026-10-10T00:00:00.000Z' }

describe('E20 contract: beat variant compare/select', () => {
  it('accepts a strict frozen original snapshot and both choices', () => {
    const base = { chapter: 1, expectedArtifactId: 'beat-b', expectedHeadVersion: 2,
      originalArtifactId: artifact.id, originalVersion: artifact.version, originalContent: original }
    expect(beatVariantSelectionRequestSchema.parse({ ...base, choice: 'new' })).toEqual({ ...base, choice: 'new' })
    expect(beatVariantSelectionRequestSchema.parse({ ...base, choice: 'original' })).toEqual({ ...base, choice: 'original' })
    expect(beatContentSchema.parse(original)).toEqual(original)
  })

  it('requires the complete compare receipt and rejects undocumented fields', () => {
    expect(beatCommandResponseSchema.shape.comparison).toBeDefined()
    expect(beatVariantSelectionRequestSchema.safeParse({ chapter: 1, expectedArtifactId: 'beat-b', expectedHeadVersion: 2,
      originalArtifactId: artifact.id, originalVersion: 1, originalContent: original, choice: 'new', extra: true }).success).toBe(false)
    expect(beatVariantSelectionResponseSchema.safeParse({
      artifact, comparison: { original: artifact, candidate: { ...artifact, id: 'beat-b', version: 2, content: { ...original, title: '新章纲' } } }, choice: 'new',
      selection: { operation: 'select-beat-variant', workId: 'work-1', chapter: 1,
        expectedHead: { artifactId: 'beat-b', version: 2 }, originalHead: { artifactId: 'beat-a', version: 1 }, choice: 'new',
        writeOutcome: 'not-committed', resultHead: { artifactId: 'beat-b', version: 2, humanStatus: 'pending' } },
    }).success).toBe(true)
  })
})
