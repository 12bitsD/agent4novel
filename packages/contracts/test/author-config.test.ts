import { describe, expect, it } from 'vitest'
import { authorConfigViewSchema, authorStepIds } from '../src/author-config.js'

const file = { id: '00000000-0000-4000-8000-000000000001', workId: 'work', kind: 'prompt' as const, name: 'author-prompt', description: 'guidance', sha256: 'a'.repeat(64), byteLength: 100, createdAt: '2026-09-30T00:00:00.000Z' }
const view = () => ({ workId: 'work', revision: 1, document: { preferences: {}, defaults: {}, steps: {} }, files: [{ ...file }],
  effective: authorStepIds.map(id => ({ id, model: 'kimi:kimi-k2.8-highspeed', provider: 'kimi', configured: false, executionMode: 'demo', generation: {}, appliedPreferences: {}, systemPrompt: { ...file }, skills: [], tools: [], directionCount: 2 })) })

describe('author configuration response association', () => {
  it('accepts the six actual steps and owned immutable files', () => expect(authorConfigViewSchema.safeParse(view()).success).toBe(true))
  it.each(['missing-file', 'changed-file', 'duplicate-file', 'wrong-kind', 'wrong-provider'])('rejects %s before a client displays actual configuration', mode => {
    const value = view()
    if (mode === 'missing-file') value.files = []
    if (mode === 'changed-file') value.effective[0]!.systemPrompt = { ...file, sha256: 'b'.repeat(64) }
    if (mode === 'duplicate-file') value.files.push({ ...file })
    if (mode === 'wrong-kind') (value.effective[0]!.systemPrompt as { kind: string }).kind = 'skill'
    if (mode === 'wrong-provider') value.effective[0]!.provider = 'longcat'
    expect(authorConfigViewSchema.safeParse(value).success).toBe(false)
  })
})
