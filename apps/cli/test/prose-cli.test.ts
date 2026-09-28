import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/client.js'
import { runProseCommand } from '../src/commands.js'

const prose = { id: 'prose-1', workId: 'work-test', kind: 'prose', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-28', content: { text: '初稿' } }
const view = { id: 'work-test', title: '合成作品', seed: '素材', config: {}, createdAt: '2026-09-28', artifacts: [prose], workflowState: 'awaiting-prose-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }
const request = { chapter: 1, expectedArtifactId: prose.id, expectedHeadVersion: 1, content: { text: '  人工修改\n\n保留空白\n' } }
describe('Agent Prose commands', () => {
  it('confirms exact author text after a lost approval response with one read and no replay', async () => {
    let writes = 0; let reads = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (_url, init) => {
      if (init?.method === 'POST') { writes++; expect(JSON.parse(init.body as string)).toEqual(request); throw new Error('response lost') }
      reads++
      return new Response(JSON.stringify(writes ? { ...view, artifacts: [{ ...prose, humanStatus: 'approved', content: request.content }], workflowState: 'prose-approved', allowedActions: [] } : view))
    } })
    const result = await runProseCommand(client, 'work-test', 'approve-prose', request)
    expect(result).toMatchObject({ artifact: { content: request.content }, confirmedBy: 'read-work' })
    expect(writes).toBe(1); expect(reads).toBe(2)
  })
  it('does not infer rewrite success from a new server head or replay a lost request', async () => {
    let writes = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (_url, init) => {
      if (init?.method === 'POST') { writes++; throw new Error('response lost') }
      return new Response(JSON.stringify({ ...view, artifacts: [writes ? { ...prose, id: 'prose-2', version: 2 } : prose] }))
    } })
    await expect(runProseCommand(client, 'work-test', 'regenerate-prose', { ...request, instructions: '' })).rejects.toMatchObject({
      code: 'prose-result-conflict', details: { resolution: 'conflict', observedHead: { artifactId: 'prose-2', version: 2 }, nextActions: ['read-work', 'load-server-version'] },
    })
    expect(writes).toBe(1)
  })
  it('rejects invalid input before reading the server and stale files before writing', async () => {
    let calls = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (_url, init) => {
      calls++; expect(init?.method).toBe('GET'); return new Response(JSON.stringify(view))
    } })
    await expect(runProseCommand(client, 'work-test', 'approve-prose', { ...request, content: { text: '  ' } })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toBe(0)
    await expect(runProseCommand(client, 'work-test', 'approve-prose', { ...request, expectedArtifactId: 'stale' })).rejects.toMatchObject({ code: 'version-conflict' })
    expect(calls).toBe(1)
  })

  it.each(['pending', 'approved'] as const)('saves %s author text with the exact file baseline and recovers a lost response once', async humanStatus => {
    for (const lostResponse of [false, true]) {
      const baseline = { ...prose, humanStatus }
      const saved = { ...baseline, id: 'prose-2', version: 2, content: request.content }
      const submitted = { ...request, expectedHumanStatus: humanStatus }
      const current = { ...view, artifacts: [baseline], workflowState: humanStatus === 'pending' ? 'awaiting-prose-review' : 'prose-approved', allowedActions: humanStatus === 'pending' ? ['save-draft', 'approve', 'regenerate'] : ['save-draft'] }
      let writes = 0; let reads = 0
      const client = createClient({ baseUrl: 'http://example.test', fetch: async (url, init) => {
        if (init?.method === 'POST') {
          writes++
          expect(url).toBe('http://example.test/api/works/work-test/artifacts/prose/save')
          expect(JSON.parse(init.body as string)).toEqual(submitted)
          if (lostResponse) throw new Error('response lost')
          return new Response(JSON.stringify({ artifact: saved, telemetry: [],
            workflow: { workflowState: current.workflowState, nextStepId: null, allowedActions: current.allowedActions },
            command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'save-prose',
              target: { workId: 'work-test', kind: 'prose', chapter: 1 }, expectedHead: { artifactId: prose.id, version: 1, humanStatus },
              executionMode: 'demo', latencyMs: 1, attemptIds: [], writeOutcome: 'committed', resultHead: { artifactId: saved.id, version: 2, humanStatus },
            },
          }))
        }
        reads++
        return new Response(JSON.stringify({ ...current, artifacts: [writes ? saved : baseline] }))
      } })
      const result = await runProseCommand(client, 'work-test', 'save-prose', submitted)
      expect(result.artifact).toEqual(saved)
      if (lostResponse) expect(result).toMatchObject({ confirmedBy: 'read-work' })
      else expect(result).toMatchObject({ command: { operation: 'save-prose', attemptIds: [] } })
      expect(writes).toBe(1)
      expect(reads).toBe(lostResponse ? 2 : 1)
    }
  })
  it('rejects invalid save files before I/O and mismatched status, identity or version before writing', async () => {
    let reads = 0; let writes = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (_url, init) => {
      if (init?.method === 'POST') writes++
      else reads++
      return new Response(JSON.stringify({ ...view, artifacts: [{ ...prose, humanStatus: 'approved' }], workflowState: 'prose-approved', allowedActions: ['save-draft'] }))
    } })
    for (const submitted of [request, { ...request, expectedHumanStatus: 'approved', content: { text: '' } }, { ...request, expectedHumanStatus: 'pending', extra: 'private-extra' }]) {
      await expect(runProseCommand(client, 'work-test', 'save-prose', submitted)).rejects.toMatchObject({ code: 'invalid-input' })
    }
    expect(reads).toBe(0)
    for (const submitted of [
      { ...request, expectedHumanStatus: 'pending' },
      { ...request, expectedHumanStatus: 'approved', expectedArtifactId: 'other-id' },
      { ...request, expectedHumanStatus: 'approved', expectedHeadVersion: 2 },
    ]) {
      await expect(runProseCommand(client, 'work-test', 'save-prose', submitted)).rejects.toMatchObject({ code: 'version-conflict', details: {
        expectedHead: { artifactId: submitted.expectedArtifactId, version: submitted.expectedHeadVersion, humanStatus: submitted.expectedHumanStatus },
        observedHead: { artifactId: prose.id, version: 1, humanStatus: 'approved' },
      } })
    }
    expect(reads).toBe(3)
    expect(writes).toBe(0)
  })
  it.each(['fetch', 'body'] as const)('bounds the full save %s request to 30 seconds and aborts local waiting', async stuck => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const client = createClient({ baseUrl: 'http://example.test', fetch: async (url, init) => {
        expect(url).toBe('http://example.test/api/works/work%2Ftest/artifacts/prose/save')
        signal = init?.signal ?? undefined
        if (stuck === 'fetch') return new Promise<Response>(() => {})
        return new Response(new ReadableStream({ start() {} }))
      } })
      const pending = client.proseCommand('work/test', { operation: 'save-prose', request: { ...request, chapter: 1, expectedHumanStatus: 'pending' } }).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toMatchObject({ code: 'network-error' })
      expect(signal?.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })

})
