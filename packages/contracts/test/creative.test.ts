import { describe, it, expect } from 'vitest'
import { creativeContentSchema, creativePackSchema, agentConfigSchema } from '../src/index.js'

const validPack = {
  directionId: 'w-1-dir-1',
  title: '预言外卖员',
  hook: '他送的不是外卖,是明天的新闻。',
  tags: ['都市', '悬疑'],
  synopsis: '外卖员发现自己的订单会在未来新闻中出现,于是开始利用这一点救人……',
  characters: [{ title: '主角', content: '外卖员,负债,观察力强' }],
  setting: [{ title: '世界观', content: '现代都市,存在未解释的预知现象' }],
  payoffs: ['小人物撬动大事件'],
  outline: [{ title: '主线', content: '发现 → 利用 → 失控 → 赎还' }],
}

const validContent = { directions: [validPack] }

describe('creativePackSchema', () => {
  it('accepts a valid direction pack(创意稿)', () => {
    const parsed = creativePackSchema.parse(validPack)
    expect(parsed.directionId).toBe('w-1-dir-1')
    expect(parsed.tags).toEqual(['都市', '悬疑'])
  })

  it('accepts empty arrays(要点可为空)', () => {
    expect(() =>
      creativePackSchema.parse({ ...validPack, characters: [], setting: [], payoffs: [], outline: [] }),
    ).not.toThrow()
  })

  it('rejects duplicate tags(tags 唯一)', () => {
    expect(() =>
      creativePackSchema.parse({ ...validPack, tags: ['都市', '都市'] }),
    ).toThrow()
  })

  it('rejects empty/oversized fields(trim + 上限)', () => {
    expect(() => creativePackSchema.parse({ ...validPack, title: '  ' })).toThrow()
    expect(() => creativePackSchema.parse({ ...validPack, hook: 'x'.repeat(501) })).toThrow()
    expect(() => creativePackSchema.parse({ ...validPack, synopsis: 'x'.repeat(2001) })).toThrow()
  })

  it('rejects unknown keys(strict)', () => {
    expect(() => creativePackSchema.parse({ ...validPack, note: 'x' })).toThrow()
  })
})

describe('creativeContentSchema', () => {
  it('accepts 1~3 directions', () => {
    expect(() => creativeContentSchema.parse(validContent)).not.toThrow()
    const three = { directions: [validPack, { ...validPack, directionId: 'w-1-dir-2' }, { ...validPack, directionId: 'w-1-dir-3' }] }
    expect(() => creativeContentSchema.parse(three)).not.toThrow()
  })

  it('rejects 0 or 4 directions(1~3 硬边界)', () => {
    expect(() => creativeContentSchema.parse({ directions: [] })).toThrow()
    const four = { directions: [1, 2, 3, 4].map((i) => ({ ...validPack, directionId: `d${i}` })) }
    expect(() => creativeContentSchema.parse(four)).toThrow()
  })
})

describe('agentConfigSchema.directionCount', () => {
  it('accepts 1~3 and undefined', () => {
    expect(agentConfigSchema.parse({}).directionCount).toBeUndefined()
    expect(agentConfigSchema.parse({ directionCount: 2 }).directionCount).toBe(2)
  })

  it('rejects 0, 4, non-int', () => {
    expect(() => agentConfigSchema.parse({ directionCount: 0 })).toThrow()
    expect(() => agentConfigSchema.parse({ directionCount: 4 })).toThrow()
    expect(() => agentConfigSchema.parse({ directionCount: 1.5 })).toThrow()
  })
})
