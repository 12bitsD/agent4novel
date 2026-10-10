import { describe, expect, it, vi } from 'vitest'
import { generateObject } from 'ai'
import { z } from 'zod'
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
  })

  it('accepts the official Moonshot credential alias without changing the provider identity', () => {
    const runtime = createModelRuntime({ MOONSHOT_API_KEY: 'synthetic-moonshot-key' })
    expect(runtime.mode).toBe('live')
    expect(runtime.defaultModelId).toBe(DEFAULT_KIMI_MODEL_ID)
  })

  it('requires a Kimi credential for an explicit Kimi model', () => {
    expect(() => createModelRuntime({ A4N_MODEL: DEFAULT_KIMI_MODEL_ID })).toThrow(ModelConfigError)
  })

  it('applies the shared safe Base URL policy to Kimi', () => {
    expect(() => createModelRuntime({ KIMI_API_KEY: 'synthetic-kimi-key', KIMI_BASE_URL: 'http://api.example.com/v1' }))
      .toThrow(ModelConfigError)
  })

  it('uses the Kimi OpenAI-compatible endpoint and wire model', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe(`${DEFAULT_KIMI_BASE_URL}/chat/completions`)
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer synthetic-kimi-key')
      const body = JSON.parse(String(init?.body)) as {
        model: string
        response_format?: { type?: string }
      }
      expect(body.model).toBe('kimi-k2.8-highspeed')
      expect(body.response_format).toEqual({ type: 'json_object' })
      return new Response(JSON.stringify({
        id: 'kimi-test',
        model: 'kimi-k2.8-highspeed',
        choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const runtime = createModelRuntime({
      A4N_MODEL: DEFAULT_KIMI_MODEL_ID,
      KIMI_API_KEY: 'synthetic-kimi-key',
    }, { fetch: fakeFetch })

    const result = await generateObject({
      model: runtime.languageModel(),
      schema: z.object({ ok: z.boolean() }),
      prompt: 'Return JSON.',
    })

    expect(result.object).toEqual({ ok: true })
    expect(fakeFetch).toHaveBeenCalledOnce()
  })
})
