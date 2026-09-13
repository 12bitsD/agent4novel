import { describe, expect, it, vi } from 'vitest'
import { generateObject } from 'ai'
import { z } from 'zod'
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
    expect(() =>
      createModelRuntime({
        LONGCAT_API_KEY: 'synthetic-longcat-key',
        LONGCAT_BASE_URL: 'http://api.example.com/openai/v1',
      }),
    ).toThrow(ModelConfigError)
    expect(() =>
      createModelRuntime({
        LONGCAT_API_KEY: 'synthetic-longcat-key',
        LONGCAT_BASE_URL: 'https://api.example.com/openai/v1?target=other',
      }),
    ).toThrow(ModelConfigError)
    expect(
      createModelRuntime({
        LONGCAT_API_KEY: 'synthetic-longcat-key',
        LONGCAT_BASE_URL: 'http://127.0.0.1:8080/openai/v1',
      }).mode,
    ).toBe('live')
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
  })

  it('honors an explicit default model and rejects missing provider credentials', () => {
    expect(
      createModelRuntime({
        A4N_MODEL: DEFAULT_LONGCAT_MODEL_ID,
        LONGCAT_API_KEY: 'synthetic-longcat-key',
      }).defaultModelId,
    ).toBe(DEFAULT_LONGCAT_MODEL_ID)

    expect(() => createModelRuntime({ A4N_MODEL: DEFAULT_LONGCAT_MODEL_ID })).toThrow(
      ModelConfigError,
    )
  })

  it('rejects unsupported per-work model overrides without trying the network', () => {
    const runtime = createModelRuntime({ LONGCAT_API_KEY: 'synthetic-longcat-key' })
    expect(() => runtime.languageModel('other:model')).toThrow(
      expect.objectContaining({
        code: 'llm-unavailable',
        message: expect.stringContaining('unsupported model id'),
        retryable: false,
      }),
    )
    expect(() => runtime.languageModel('')).toThrow(
      expect.objectContaining({ code: 'llm-unavailable', retryable: false }),
    )
  })

  it('adapts LongCat to Chat Completions with Bearer auth and json_object output', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://api.longcat.chat/openai/v1/chat/completions')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer synthetic-longcat-key')
      const body = JSON.parse(String(init?.body)) as {
        model: string
        response_format?: { type?: string }
      }
      expect(body.model).toBe('LongCat-2.0')
      expect(body.response_format).toEqual({ type: 'json_object' })

      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: 'LongCat-2.0',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"ok":true}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const runtime = createModelRuntime(
      {
        A4N_MODEL: DEFAULT_LONGCAT_MODEL_ID,
        LONGCAT_API_KEY: 'synthetic-longcat-key',
      },
      { fetch: fakeFetch },
    )

    const result = await generateObject({
      model: runtime.languageModel(),
      schema: z.object({ ok: z.boolean() }),
      prompt: 'Return JSON.',
    })

    expect(result.object).toEqual({ ok: true })
    expect(fakeFetch).toHaveBeenCalledOnce()
  })
  it('sends the LongCat story defaults and permits explicit thinking/sampling overrides', async () => {
    const bodies: Record<string, unknown>[] = []
    const runtime = createModelRuntime({ LONGCAT_API_KEY: 'synthetic-key' }, {
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ id: 'sampling-test', model: 'LongCat-2.0',
          choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
        }), { headers: { 'content-type': 'application/json' } })
      },
    })
    for (const config of [{}, { thinking: 'enabled' as const, temperature: 0, topP: 1 }]) {
      await generateObject({ model: runtime.languageModel(), schema: z.object({ ok: z.boolean() }),
        prompt: 'Return JSON.', ...runtime.generationSettings(config).options })
    }
    expect(bodies[0]).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0.9, top_p: 0.95 })
    expect(bodies[1]).toMatchObject({ thinking: { type: 'enabled' }, temperature: 0, top_p: 1 })
    expect(bodies[0]).not.toHaveProperty('top_k')
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
