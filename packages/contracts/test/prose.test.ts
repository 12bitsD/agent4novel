import { describe, expect, it } from 'vitest'
import * as contracts from '../src/index.js'

describe('first-chapter prose contracts', () => {
  it('preserves author whitespace and accepts short complete prose while rejecting empty or unknown content', () => {
    const schema = contracts.proseContentSchema
    expect(schema).toBeDefined()
    const content = { text: '  第一行。\n\n  第二行。\n' }
    expect(schema.parse(content)).toEqual(content)
    for (const invalid of [{ text: ' \n ' }, { text: '文字', title: '重复标题' }, { text: 42 }, { text: '文'.repeat(100001) }]) {
      expect(schema.safeParse(invalid).success).toBe(false)
    }
    expect(schema.safeParse({ text: '🙂'.repeat(50000) }).success).toBe(true)
  })
  it('allows an unfinished rewrite but requires a complete author approval bound to chapter and head', () => {
    const head = { chapter: 1, expectedArtifactId: 'artifact-source', expectedHeadVersion: 1 }
    expect(contracts.proseRegenerateRequestSchema).toBeDefined()
    expect(contracts.proseRegenerateRequestSchema.parse({ ...head, content: { text: '' }, instructions: '' })).toMatchObject({ content: { text: '' } })
    expect(contracts.proseApproveRequestSchema.safeParse({ ...head, content: { text: '' } }).success).toBe(false)
    for (const invalid of [{ ...head, chapter: 0 }, { ...head, expectedHeadVersion: 0 }, { ...head, extra: true }]) {
      expect(contracts.proseApproveRequestSchema.safeParse({ ...invalid, content: { text: '正文' } }).success).toBe(false)
    }
    expect(contracts.proseRegenerateRequestSchema.safeParse({ ...head, content: { text: '文' }, instructions: '意'.repeat(10001) }).success).toBe(false)
  })
})
