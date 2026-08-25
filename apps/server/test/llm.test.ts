import { describe, it, expect, afterEach } from 'vitest'
import { defaultModelId, hasLlmKey } from '../src/steps/llm.js'

describe('llm registry', () => {
  const original = process.env.DEEPSEEK_API_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = original
  })

  it('hasLlmKey reflects DEEPSEEK_API_KEY', () => {
    delete process.env.DEEPSEEK_API_KEY
    expect(hasLlmKey()).toBe(false)
    process.env.DEEPSEEK_API_KEY = 'test-key'
    expect(hasLlmKey()).toBe(true)
  })

  it('default model id uses the deepseek registry prefix', () => {
    expect(defaultModelId).toMatch(/^deepseek:/)
  })
})
