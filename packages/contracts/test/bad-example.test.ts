import { describe, expect, it } from 'vitest'
import { badExampleRequestSchema, badExamplePageSchema } from '../src/index.js'

const input = { requestId: '00000000-0000-4000-8000-000000000001', chapter: 2, sourceArtifactId: 'artifact-id', sourceVersion: 3, sourceHash: 'a'.repeat(64), start: 1, end: 3, text: '😀', note: '' }
const schemas = { badExampleRequestSchema }
describe('bad-example request contract', () => {
  it('accepts an explicit saved-source Unicode selection', () => expect(schemas.badExampleRequestSchema?.safeParse(input).success).toBe(true))
  it.each([{ chapter: 0 }, { sourceVersion: 1.1 }, { start: -1 }, { end: 1 }, { text: 'x' }, { sourceHash: 'a'.repeat(12) }, { requestId: 'operation' }, { note: 'x'.repeat(2001) }, { text: '\ud83d', end: 2 }, { text: ' '.repeat(2) }, { extra: true }])('rejects invalid source/selection %j', delta => expect(schemas.badExampleRequestSchema?.safeParse({ ...input, ...delta }).success).toBe(false))
  it('refuses malformed, duplicate or cross-chapter list records', () => {
    const { requestId, ...fields } = input, item = { id: requestId, workId: 'work', ...fields, createdAt: '2026-09-30T00:00:00Z' }
    expect(badExamplePageSchema.safeParse({ workId: 'work', chapter: 2, items: [item] }).success).toBe(true)
    for (const page of [{ workId: 'other', items: [item] }, { workId: 'work', chapter: 1, items: [item] }, { workId: 'work', items: [item, item] }, { workId: 'work', items: [], nextCursor: 1 }]) expect(badExamplePageSchema.safeParse(page).success).toBe(false)
  })
})
