import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEFAULT_LONGCAT_MODEL_ID,
  ModelConfigError,
  createModelRuntime,
} from '../src/steps/llm.js'

describe('ModelRuntime', () => {
  it('uses demo mode when no provider credential is configured', () => {
    const runtime = createModelRuntime({})
    expect(runtime.mode).toBe('demo')
    expect(runtime.defaultModelId).toBe(DEFAULT_DEEPSEEK_MODEL_ID)
    expect(runtime.requestTimeoutMs).toBe(120_000)
  })

  it('validates an optional startup request timeout', () => {
    expect(createModelRuntime({ A4N_LLM_TIMEOUT_MS: '300000' }).requestTimeoutMs).toBe(300_000)
    expect(() => createModelRuntime({ A4N_LLM_TIMEOUT_MS: 'forever' })).toThrow(ModelConfigError)
  })

  it('protects provider credentials from unsafe base URLs', () => {
    expect(() => createModelRuntime({
      LONGCAT_API_KEY: 'synthetic-longcat-key',
      LONGCAT_BASE_URL: 'http://api.example.com/openai/v1',
    })).toThrow(ModelConfigError)
    expect(() => createModelRuntime({
      LONGCAT_API_KEY: 'synthetic-longcat-key',
      LONGCAT_BASE_URL: 'https://api.example.com/openai/v1?target=other',
    })).toThrow(ModelConfigError)
    expect(createModelRuntime({
      LONGCAT_API_KEY: 'synthetic-longcat-key',
      LONGCAT_BASE_URL: 'http://127.0.0.1:8080/openai/v1',
    }).mode).toBe('live')
  })

  it('selects LongCat when it is the only configured provider', () => {
    const runtime = createModelRuntime({ LONGCAT_API_KEY: 'synthetic-longcat-key' })
    expect(runtime.mode).toBe('live')
    expect(runtime.defaultModelId).toBe(DEFAULT_LONGCAT_MODEL_ID)
  })

  it('keeps DeepSeek as the backward-compatible default when both providers exist', () => {
    const runtime = createModelRuntime({
      DEEPSEEK_API_KEY: 'synthetic-deepseek-key',
      LONGCAT_API_KEY: 'synthetic-longcat-key',
    })
    expect(runtime.defaultModelId).toBe(DEFAULT_DEEPSEEK_MODEL_ID)
    expect(runtime.languageModel()).toEqual({
      modelId: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    })
  })

  it('honors an explicit default model and rejects missing provider credentials', () => {
    expect(createModelRuntime({
      A4N_MODEL: DEFAULT_LONGCAT_MODEL_ID,
      LONGCAT_API_KEY: 'synthetic-longcat-key',
    }).defaultModelId).toBe(DEFAULT_LONGCAT_MODEL_ID)
    expect(() => createModelRuntime({ A4N_MODEL: DEFAULT_LONGCAT_MODEL_ID })).toThrow(ModelConfigError)
  })

  it('rejects unsupported per-work model overrides without trying the network', () => {
    const runtime = createModelRuntime({ LONGCAT_API_KEY: 'synthetic-longcat-key' })
    expect(() => runtime.languageModel('other:model')).toThrow(expect.objectContaining({
      code: 'llm-unavailable',
      message: expect.stringContaining('unsupported model id'),
      retryable: false,
    }))
    expect(() => runtime.languageModel('')).toThrow(expect.objectContaining({
      code: 'llm-unavailable', retryable: false,
    }))
  })

  it('provides the LongCat Nextloop configuration and story defaults', () => {
    const runtime = createModelRuntime({
      A4N_MODEL: DEFAULT_LONGCAT_MODEL_ID,
      LONGCAT_API_KEY: 'synthetic-longcat-key',
      LONGCAT_BASE_URL: 'http://127.0.0.1:8080/openai/v1',
    })
    expect(runtime.languageModel()).toEqual({
      modelId: 'LongCat-2.0',
      baseUrl: 'http://127.0.0.1:8080/openai/v1',
      apiKeyEnv: 'LONGCAT_API_KEY',
    })
    expect(runtime.generationSettings({})).toEqual({
      parameters: { thinking: 'disabled', temperature: 0.9, topP: 0.95 },
      options: {
        temperature: 0.9,
        topP: 0.95,
        providerOptions: { longcat: { thinking: { type: 'disabled' } } },
      },
    })
    expect(runtime.generationSettings({ thinking: 'enabled', temperature: 0, topP: 1 }).options).toEqual({
      temperature: 0,
      topP: 1,
      providerOptions: { longcat: { thinking: { type: 'enabled' } } },
    })
  })

  it('rejects invalid controls and keeps LongCat defaults out of other providers', () => {
    const runtime = createModelRuntime({ LONGCAT_API_KEY: 'synthetic-key', DEEPSEEK_API_KEY: 'synthetic-key' })
    expect(runtime.generationSettings({})).toEqual({ parameters: {}, options: {} })
    expect(runtime.generationSettings({ model: DEFAULT_LONGCAT_MODEL_ID }).parameters)
      .toEqual({ thinking: 'disabled', temperature: 0.9, topP: 0.95 })
    expect(runtime.generationSettings({ temperature: 0.7, topP: 1 }).options)
      .toEqual({ temperature: 0.7, topP: 1 })
    for (const config of [{ temperature: -0.1 }, { temperature: 1.1 }, { temperature: NaN },
      { temperature: Infinity }, { topP: 0 }, { topP: 1.1 }, { thinking: 'disabled' as const }]) {
      expect(() => runtime.generationSettings(config)).toThrow(expect.objectContaining({ code: 'llm-unavailable', retryable: false }))
    }
  })
})
