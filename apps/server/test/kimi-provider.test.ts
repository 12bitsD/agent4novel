import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KIMI_MODEL_ID,
  DEFAULT_KIMI_BASE_URL,
  ModelConfigError,
  createModelRuntime,
} from '../src/steps/llm.js'

describe('Kimi ModelRuntime provider', () => {
  it('selects Kimi when it is the only configured provider', () => {
    const runtime = createModelRuntime({ KIMI_API_KEY: 'synthetic-kimi-key' })
    expect(runtime.mode).toBe('live')
    expect(runtime.defaultModelId).toBe(DEFAULT_KIMI_MODEL_ID)
    expect(runtime.languageModel()).toEqual({
      modelId: 'kimi-k2.8-highspeed',
      baseUrl: DEFAULT_KIMI_BASE_URL,
      apiKeyEnv: 'KIMI_API_KEY',
    })
  })

  it('accepts the official Moonshot credential alias without changing the provider identity', () => {
    const runtime = createModelRuntime({ MOONSHOT_API_KEY: 'synthetic-moonshot-key' })
    expect(runtime.mode).toBe('live')
    expect(runtime.defaultModelId).toBe(DEFAULT_KIMI_MODEL_ID)
    expect(runtime.languageModel().apiKeyEnv).toBe('MOONSHOT_API_KEY')
  })

  it('requires a Kimi credential for an explicit Kimi model', () => {
    expect(() => createModelRuntime({ A4N_MODEL: DEFAULT_KIMI_MODEL_ID })).toThrow(ModelConfigError)
  })

  it('applies the shared safe Base URL policy to Kimi', () => {
    expect(() => createModelRuntime({ KIMI_API_KEY: 'synthetic-kimi-key', KIMI_BASE_URL: 'http://api.example.com/v1' }))
      .toThrow(ModelConfigError)
  })

  it('passes a model override to the same Nextloop provider', () => {
    const runtime = createModelRuntime({
      KIMI_API_KEY: 'synthetic-kimi-key',
      KIMI_BASE_URL: 'http://127.0.0.1:8080/v1',
    })
    expect(runtime.languageModel('kimi:other-model')).toEqual({
      modelId: 'other-model',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKeyEnv: 'KIMI_API_KEY',
    })
  })
})
