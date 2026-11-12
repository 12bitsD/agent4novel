import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { assertNextloopReady, runNextloop } from '../src/steps/nextloop-client.js'

let server: Server
let baseUrl = ''
let requestBody: Record<string, unknown> = {}
let authorization: string | undefined
let responseMode: 'success' | 'error' | 'timeout' = 'success'

beforeAll(async () => {
  server = createServer((request, response) => {
    const parts: Buffer[] = []
    request.on('data', chunk => parts.push(Buffer.from(chunk)))
    request.on('end', () => {
      authorization = request.headers.authorization
      requestBody = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (responseMode === 'timeout') return
      if (responseMode === 'error') {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_TEXT' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":' }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server address')
  baseUrl = `http://127.0.0.1:${address.port}/v1`
})

afterEach(() => {
  responseMode = 'success'
  requestBody = {}
  authorization = undefined
  vi.unstubAllEnvs()
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

function args(overrides: { timeoutMs?: number } = {}) {
  vi.stubEnv('A4N_NEXTLOOP_PYTHON', fileURLToPath(new URL('../../../.venv/bin/python', import.meta.url)))
  vi.stubEnv('LONGCAT_API_KEY', 'synthetic-longcat-key')
  return {
    schema: z.object({ ok: z.boolean() }),
    model: { modelId: 'LongCat-2.0', baseUrl, apiKeyEnv: 'LONGCAT_API_KEY' as const },
    system: 'Return a JSON object.',
    prompt: 'Return ok=true.',
    attemptId: 'node-nextloop-1',
    timeoutMs: overrides.timeoutMs ?? 1000,
    maxOutputTokens: 8000,
    maxRetries: 0,
    temperature: 0.7,
    topP: 0.95,
    providerOptions: { longcat: { thinking: { type: 'disabled' as const } } },
  }
}

describe('Nextloop stdio client', () => {
  it('runs the real Python AgentLoop and preserves provider options', async () => {
    const result = await runNextloop(args())

    expect(result).toEqual({ object: { ok: true }, usage: { inputTokens: 3, outputTokens: 2 }, finishReason: 'stop' })
    expect(authorization).toBe('Bearer synthetic-longcat-key')
    expect(requestBody).toEqual({
      model: 'LongCat-2.0',
      messages: [{ role: 'system', content: 'Return a JSON object.' }, { role: 'user', content: 'Return ok=true.' }],
      stream: true,
      response_format: { type: 'json_object' },
      max_tokens: 8000,
      temperature: 0.7,
      top_p: 0.95,
      thinking: { type: 'disabled' },
    })
  })

  it('maps provider failures without exposing the response body', async () => {
    responseMode = 'error'

    await expect(runNextloop(args())).rejects.toMatchObject({
      code: 'llm-unavailable',
      retryable: true,
      message: expect.not.stringContaining('PRIVATE_PROVIDER_TEXT'),
    })
  })

  it('maps provider and turn timeouts to llm-timeout', async () => {
    responseMode = 'timeout'

    await expect(runNextloop(args({ timeoutMs: 50 }))).rejects.toMatchObject({
      code: 'llm-timeout',
      retryable: true,
    })
  })

  it('checks the local Python and Nextloop runtime without a provider call', async () => {
    vi.stubEnv('A4N_NEXTLOOP_PYTHON', fileURLToPath(new URL('../../../.venv/bin/python', import.meta.url)))
    await expect(assertNextloopReady()).resolves.toBeUndefined()
    expect(requestBody).toEqual({})

    vi.stubEnv('A4N_NEXTLOOP_PYTHON', '/definitely/missing/python')
    await expect(assertNextloopReady()).rejects.toMatchObject({ code: 'llm-unavailable', retryable: false })
  })
})
