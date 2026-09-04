import { describe, it, expect } from 'vitest'
import {
  outlineContentSchema,
  outlineArcSchema,
  outlineSegmentSchema,
  workflowStates,
} from '../src/index.js'

const validSegment = {
  segmentId: 'w-1-arc-1-seg-1',
  title: '退婚现场',
  summary: '主角被当众退婚,立下三年之约。',
  outcome: '主角被逐出家门,与家族决裂。',
}

const validArc = {
  arcId: 'w-1-arc-1',
  title: '退婚之辱',
  conflict: '主角被当众退婚,家族地位崩塌。',
  development: '被逐出家门后遗物觉醒金手指,暗中积蓄实力。',
  resolution: '宗门大比击败对方天才,一雪前耻,立足宗门。',
  segments: [
    validSegment,
    { ...validSegment, segmentId: 'w-1-arc-1-seg-2', title: '遗物觉醒' },
  ],
}

function arc(id: string) {
  return {
    ...validArc,
    arcId: id,
    segments: validArc.segments.map((s, j) => ({ ...s, segmentId: `${id}-seg-${j + 1}` })),
  }
}

const validContent = { arcs: [arc('w-1-arc-1'), arc('w-1-arc-2'), arc('w-1-arc-3')] }

describe('outlineSegmentSchema(剧情点)', () => {
  it('accepts a valid segment', () => {
    expect(outlineSegmentSchema.parse(validSegment).outcome).toBe(validSegment.outcome)
  })

  it('rejects empty/oversized fields(trim + 上限)', () => {
    expect(() => outlineSegmentSchema.parse({ ...validSegment, title: '  ' })).toThrow()
    expect(() => outlineSegmentSchema.parse({ ...validSegment, title: 'x'.repeat(31) })).toThrow()
    expect(() => outlineSegmentSchema.parse({ ...validSegment, summary: 'x'.repeat(501) })).toThrow()
    expect(() => outlineSegmentSchema.parse({ ...validSegment, outcome: '' })).toThrow()
  })

  it('rejects unknown keys(strict)', () => {
    expect(() => outlineSegmentSchema.parse({ ...validSegment, note: 'x' })).toThrow()
  })
})

describe('outlineArcSchema(弧线)', () => {
  it('accepts a valid arc', () => {
    expect(outlineArcSchema.parse(validArc).segments).toHaveLength(2)
  })

  it('rejects arcs with 1 or 9 segments(每弧剧情点 2~8)', () => {
    expect(() => outlineArcSchema.parse({ ...validArc, segments: [validSegment] })).toThrow()
    expect(() =>
      outlineArcSchema.parse({
        ...validArc,
        segments: Array.from({ length: 9 }, (_, j) => ({
          ...validSegment,
          segmentId: `s-${j}`,
        })),
      }),
    ).toThrow()
  })
})

describe('outlineContentSchema(大纲)', () => {
  it('accepts 3~8 arcs', () => {
    expect(outlineContentSchema.parse(validContent).arcs).toHaveLength(3)
    expect(() =>
      outlineContentSchema.parse({ arcs: Array.from({ length: 8 }, (_, i) => arc(`a-${i}`)) }),
    ).not.toThrow()
  })

  it('rejects 2 or 9 arcs(弧线 3~8)', () => {
    expect(() =>
      outlineContentSchema.parse({ arcs: [arc('a-1'), arc('a-2')] }),
    ).toThrow()
    expect(() =>
      outlineContentSchema.parse({ arcs: Array.from({ length: 9 }, (_, i) => arc(`a-${i}`)) }),
    ).toThrow()
  })

  it('rejects unknown keys(strict)', () => {
    expect(() => outlineContentSchema.parse({ ...validContent, note: 'x' })).toThrow()
  })
})

describe('workflowStates(#13 扩展并保留旧大纲末态)', () => {
  it('includes Setting review and completion while keeping selected removed', () => {
    expect([...workflowStates]).toEqual([
      'ready-to-generate',
      'awaiting-selection',
      'awaiting-outline-review',
      'outline-approved',
      'awaiting-setting-review',
      'setting-approved',
      'failed',
    ])
  })
})
