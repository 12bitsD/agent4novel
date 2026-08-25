import { describe, it, expect } from 'vitest'
import { outlineContentSchema } from '../src/index.js'

describe('outlineContentSchema', () => {
  it('accepts a chapters list（分章无卷）', () => {
    const parsed = outlineContentSchema.parse({
      chapters: [
        { number: 1, title: '觉醒', summary: '主角觉醒读心能力' },
        { number: 2, title: '暗战', summary: '卷入异能者暗战' },
      ],
    })
    expect(parsed.chapters).toHaveLength(2)
  })

  it('rejects a chapter without summary', () => {
    expect(() =>
      outlineContentSchema.parse({ chapters: [{ number: 1, title: 'x' }] }),
    ).toThrow()
  })

  it('rejects a non-number chapter number', () => {
    expect(() =>
      outlineContentSchema.parse({ chapters: [{ number: '1', title: 'x', summary: 'y' }] }),
    ).toThrow()
  })
})
