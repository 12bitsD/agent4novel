import { describe, expect, it } from 'vitest'
import { approveRequestSchema, creativeDraftRequestSchema, outlineDraftRequestSchema, selectCreativeRequestSchema,
  workCreateRequestSchema, workListResponseSchema } from '../src/index.js'

describe('public work requests and summaries', () => {
  it('keeps creation as input-only data and refuses caller supplied identity/configuration', () => {
    expect(workCreateRequestSchema.parse({ seed: '脑洞', title: '作品' })).toEqual({ seed: '脑洞', title: '作品' })
    expect(workCreateRequestSchema.safeParse({ seed: '脑洞', id: 'injected' }).success).toBe(false)
    expect(workCreateRequestSchema.safeParse({ seed: '脑洞', config: {} }).success).toBe(false)
  })
  it('requires bounded integral version preconditions and known request fields', () => {
    expect(selectCreativeRequestSchema.parse({ directionId: 'dir1', expectedHeadVersion: 1 })).toEqual({ directionId: 'dir1', expectedHeadVersion: 1 })
    for (const version of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(selectCreativeRequestSchema.safeParse({ directionId: 'dir1', expectedHeadVersion: version }).success).toBe(false)
    }
    expect(selectCreativeRequestSchema.safeParse({ directionId: 'dir1', expectedHeadVersion: 1, humanStatus: 'approved' }).success).toBe(false)
    expect(creativeDraftRequestSchema.safeParse({ content: { text: 'wrong kind' }, expectedHeadVersion: 1 }).success).toBe(false)
    expect(outlineDraftRequestSchema.safeParse({ content: { directions: [] }, expectedHeadVersion: 1 }).success).toBe(false)
  })
  it('requires chapter addresses only for per-chapter general approval', () => {
    expect(approveRequestSchema.parse({ kind: 'outline' })).toEqual({ kind: 'outline' })
    expect(approveRequestSchema.parse({ kind: 'beat', chapter: 2 })).toEqual({ kind: 'beat', chapter: 2 })
    for (const request of [{ kind: 'beat' }, { kind: 'outline', chapter: 1 }, { kind: 'prose', chapter: 1.5 }, { kind: 'outline', bypass: true }]) {
      expect(approveRequestSchema.safeParse(request).success).toBe(false)
    }
  })
  it('validates complete work summaries and rejects a negative chapter count', () => {
    const summary = { id: 'w1', title: '作品', seedPreview: '脑洞', chapterCount: 0 }
    expect(workListResponseSchema.parse([summary])).toEqual([summary])
    expect(workListResponseSchema.safeParse([{ ...summary, chapterCount: -1 }]).success).toBe(false)
  })
})
