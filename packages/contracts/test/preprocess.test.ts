import { describe, it, expect } from 'vitest'
import { preprocessContentSchema } from '../src/index.js'

describe('preprocessContentSchema (provisional)', () => {
  it('accepts the four string fields', () => {
    const parsed = preprocessContentSchema.parse({
      hook: '卖点',
      synopsis: '梗概',
      setting: '设定',
      outline: '大纲',
    })
    expect(parsed.hook).toBe('卖点')
  })

  it('rejects a missing field', () => {
    expect(() => preprocessContentSchema.parse({ hook: 'x', synopsis: 'y', setting: 'z' })).toThrow()
  })

  it('rejects a non-string field', () => {
    expect(() =>
      preprocessContentSchema.parse({ hook: 1, synopsis: 'y', setting: 'z', outline: 'w' }),
    ).toThrow()
  })
})
