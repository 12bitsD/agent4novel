import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'
import { approveOutline } from '../src/commands.js'
import { outlineContent } from './public-fixtures.js'

const request = { expectedArtifactId: 'outline-1', expectedHeadVersion: 1 }
const approved = { id: 'outline-1', workId: 'w1', kind: 'outline', version: 1, humanStatus: 'approved', createdAt: 'original', content: outlineContent() }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('visible Outline CLI command and Client', () => {
  it('submits the explicit file baseline once without reading or replacing it', async () => {
    const calls: Array<{ method?: string; path: string; body: unknown }> = []
    const client = createClient({ baseUrl: 'http://local', fetch: async (url, init) => {
      calls.push({ method: init?.method, path: new URL(url).pathname, body: JSON.parse(String(init?.body)) })
      return json(approved)
    } })
    await expect(approveOutline(client, 'w1', request)).resolves.toEqual(approved)
    expect(calls).toEqual([{ method: 'POST', path: '/api/works/w1/artifacts/outline/approve', body: request }])
    expect(request).toEqual({ expectedArtifactId: 'outline-1', expectedHeadVersion: 1 })
  })

  it('preserves a definite same-endpoint rejection and never refreshes or replays', async () => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://local', fetch: async (_url, init) => {
      calls.push(init!.method!)
      return json({ code: 'version-conflict', message: 'outline changed', retryable: false }, 409)
    } })
    await expect(approveOutline(client, 'w1', request)).rejects.toMatchObject({ code: 'version-conflict', status: 409 })
    expect(calls).toEqual(['POST'])
  })

  it.each(['transport', '500', 'malformed-409', 'new-head', 'wrong-work', 'wrong-command'] as const)('keeps %s unknown with only the original POST', async scenario => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://local', fetch: async (_url, init) => {
      calls.push(init!.method!)
      if (scenario === 'transport') throw new Error('synthetic transport loss')
      if (scenario === '500') return json({ code: 'internal-error', message: 'response unavailable', retryable: false }, 500)
      if (scenario === 'malformed-409') return new Response('<html>proxy</html>', { status: 409 })
      if (scenario === 'wrong-command') return json({ code: 'version-conflict', message: 'another command', retryable: false,
        command: { kind: 'request-rejected', requestId: '11111111-1111-4111-8111-111111111111', operation: 'approve-prose',
          executionMode: 'demo', latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'request' } }, 409)
      return json(scenario === 'new-head' ? { ...approved, id: 'outline-2', version: 2 } : { ...approved, workId: 'w2' })
    } })
    await expect(approveOutline(client, 'w1', request)).rejects.toMatchObject({ status: undefined, details: { writeOutcome: 'unknown' } })
    expect(calls).toEqual(['POST'])
    expect(request.expectedHeadVersion).toBe(1)
  })

  it('validates direct Client input and command files before any request', async () => {
    let requests = 0
    const client = createClient({ baseUrl: 'http://local', fetch: async () => { requests++; return json(approved) } })
    await expect(client.approveOutline('w1', { ...request, expectedHeadVersion: 0 })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(approveOutline(client, 'w1', { expectedHeadVersion: 1 })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(requests).toBe(0)
  })

  it('keeps generic current-head approval available with its original state response', async () => {
    const calls: unknown[] = []
    const state = { workId: 'w1', stage: 'complete', nextStepId: null }
    const client = createClient({ baseUrl: 'http://local', fetch: async (url, init) => {
      calls.push({ path: new URL(url).pathname, body: JSON.parse(String(init?.body)) })
      return json(state)
    } })
    await expect(client.approve('w1', 'outline')).resolves.toEqual(state)
    expect(calls).toEqual([{ path: '/api/works/w1/approve', body: { kind: 'outline' } }])
  })
})
