import { describe, it, expect } from 'vitest'
import { captionContentSchema, inputStages } from '../src/index.js'

const validCaption = {
  inputStage: '脑洞',
  summary: '外卖员发现自己送的每单外卖都会在未来新闻里出现。',
  elements: [
    { kind: '人物', content: '主角:外卖员,负债,观察力强' },
    { kind: '冲突', content: '预知的是灾难还是订单,无法分辨' },
  ],
  gaps: ['能力来源未说明'],
}

describe('captionContentSchema', () => {
  it('accepts a valid caption(提炼稿)', () => {
    const parsed = captionContentSchema.parse(validCaption)
    expect(parsed.inputStage).toBe('脑洞')
    expect(parsed.elements).toHaveLength(2)
  })

  it('accepts empty elements/gaps', () => {
    expect(() =>
      captionContentSchema.parse({ ...validCaption, elements: [], gaps: [] }),
    ).not.toThrow()
  })

  it('trims surrounding whitespace', () => {
    const parsed = captionContentSchema.parse({ ...validCaption, summary: '  提炼  ' })
    expect(parsed.summary).toBe('提炼')
  })

  it('rejects empty summary(非空约束)', () => {
    expect(() => captionContentSchema.parse({ ...validCaption, summary: '   ' })).toThrow()
  })

  it('rejects oversized summary(长度上限)', () => {
    expect(() =>
      captionContentSchema.parse({ ...validCaption, summary: 'x'.repeat(2001) }),
    ).toThrow()
  })

  it('rejects unknown keys(strict)', () => {
    expect(() =>
      captionContentSchema.parse({ ...validCaption, extra: 'nope' }),
    ).toThrow()
  })

  it('rejects an unknown inputStage', () => {
    expect(() =>
      captionContentSchema.parse({ ...validCaption, inputStage: '随笔' }),
    ).toThrow()
  })

  it('rejects too many elements/gaps(数量上限)', () => {
    const elements = Array.from({ length: 21 }, (_, i) => ({ kind: 'k', content: `c${i}` }))
    expect(() => captionContentSchema.parse({ ...validCaption, elements })).toThrow()
    const gaps = Array.from({ length: 11 }, (_, i) => `g${i}`)
    expect(() => captionContentSchema.parse({ ...validCaption, gaps })).toThrow()
  })
})

describe('inputStages(re-export)', () => {
  it('keeps the four canonical stages', () => {
    expect([...inputStages]).toEqual(['脑洞', '设定', '主线', '模板'])
  })
})
