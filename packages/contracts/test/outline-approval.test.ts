import { describe, expect, it } from 'vitest'
import { outlineApprovalRequestSchema, outlineApprovalResponseSchema, matchesOutlineApprovalResponse } from '../src/index.js'

const request = { expectedArtifactId: 'outline-1', expectedHeadVersion: 1 }
const approved = { id: 'outline-1', workId: 'work-1', kind: 'outline', version: 1, humanStatus: 'approved', createdAt: 'original', content: {
  arcs: [1, 2, 3].map(i => ({ arcId: `arc-${i}`, title: '弧线', conflict: '冲突', development: '发展', resolution: '落点',
    segments: [1, 2].map(j => ({ segmentId: `segment-${i}-${j}`, title: '剧情点', summary: '行动', outcome: '落点' })) })),
} }

describe('visible Outline approval contract', () => {
  it('accepts only an explicit nonempty identity and positive safe version without content or chapter', () => {
    expect(outlineApprovalRequestSchema.parse(request)).toEqual(request)
    for (const invalid of [{ expectedHeadVersion: 1 }, { ...request, expectedArtifactId: '' }, { ...request, expectedHeadVersion: 0 },
      { ...request, expectedHeadVersion: 1.5 }, { ...request, expectedHeadVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...request, chapter: 1 }, { ...request, content: {} }]) expect(outlineApprovalRequestSchema.safeParse(invalid).success).toBe(false)
  })
  it('confirms an approved exact target without identifying which HTTP operation won', () => {
    expect(outlineApprovalResponseSchema.parse(approved)).toEqual(approved)
    expect(matchesOutlineApprovalResponse('work-1', request, approved)).toBe(true)
    for (const wrong of [{ ...approved, workId: 'work-2' }, { ...approved, id: 'other' }, { ...approved, version: 2 },
      { ...approved, humanStatus: 'pending' }, { ...approved, kind: 'setting' }, { ...approved, chapter: 1 },
      { ...approved, content: {} }, { ...approved, command: { requestId: 'unverified' } }]) {
      expect(matchesOutlineApprovalResponse('work-1', request, wrong)).toBe(false)
    }
  })
})
