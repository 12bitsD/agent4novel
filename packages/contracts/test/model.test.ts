import { describe, expect, it } from 'vitest'
import { modelIdSchema, parseModelId, providerForModel } from '../src/index.js'

describe('model identifiers', () => {
  it('parses every registered provider and maps it without changing the id', () => {
    const models = [
      ['deepseek:deepseek-chat', 'deepseek'],
      ['deepseek:model_A.1-x', 'deepseek'],
      [`deepseek:${'a'.repeat(96)}`, 'deepseek'],
      ['kimi:kimi-k2.8-highspeed', 'kimi'],
      ['longcat:LongCat-2.0', 'longcat'],
    ] as const
    for (const [modelId, provider] of models) {
      expect(modelIdSchema.parse(modelId)).toBe(modelId)
      expect(parseModelId(modelId)).toBe(modelId)
      expect(providerForModel(modelId)).toBe(provider)
    }
  })

  it('rejects malformed or unregistered ids without falling back to DeepSeek', () => {
    const invalid: unknown[] = [
      '', 'test-model', 'deepseek:', 'kimi:', 'deepseek:two:parts', 'deepseek:bad model',
      'deepseek:slash/model', `deepseek:${'a'.repeat(97)}`, 'longcat:LongCat-2.1',
      'longcat:longcat-2.0', 'Kimi:kimi-k2.8-highspeed', 'openai:gpt', null, undefined, 42,
    ]
    for (const value of invalid) {
      expect(modelIdSchema.safeParse(value).success).toBe(false)
      expect(parseModelId(value)).toBeNull()
      expect(providerForModel(value)).toBeNull()
    }
  })
})
