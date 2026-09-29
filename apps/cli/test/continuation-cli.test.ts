import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'
import * as commands from '../src/commands.js'

const request = { chapter: 2, expectedPreviousProseId: 'prose-one', expectedPreviousProseVersion: 3 }
const state = { workId: 'work/test', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'beat', chapter: 2 } }

describe('explicit continuation commands', () => {
  it('submits the exact chapter and previous-prose baseline once with an encoded work address', async () => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (url, init) => {
      calls.push(url)
      expect(init?.method).toBe('POST')
      expect(JSON.parse(init?.body as string)).toEqual(request)
      return new Response(JSON.stringify({ kind: 'awaiting-approval', state, telemetry: [] }))
    } })
    expect(await commands.startChapter(client, 'work/test', request)).toMatchObject({ kind: 'awaiting-approval', state: { pendingGate: { chapter: 2 } } })
    expect(calls).toEqual(['http://example.test/api/works/work%2Ftest/chapters/start'])
  })
  it('rejects invalid baseline files before HTTP and never auto-replays an unknown start result', async () => {
    let calls = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async () => { calls++; throw new Error('private-provider-body') } })
    for (const input of [{ ...request, chapter: 1 }, { ...request, chapter: 1.2 }, { ...request, chapter: Number.MAX_SAFE_INTEGER + 1 }, { ...request, expectedPreviousProseVersion: 0 }, { ...request, extra: 'private-field' }]) {
      await expect(commands.startChapter(client, 'work/test', input)).rejects.toMatchObject({ code: 'invalid-input' })
    }
    expect(calls).toBe(0)
    await expect(commands.startChapter(client, 'work/test', request)).rejects.toMatchObject({ code: 'network-error' })
    expect(calls).toBe(1)
  })
  it.each(['beat', 'prose'] as const)('addresses chapter two %s and reconciles exactly that chapter after a lost approval response', async kind => {
    const content = kind === 'beat' ? { title: '第二章', goal: '继续', writingPlan: [{ itemId: 'item-two', title: '行动', content: '追踪线索' }], ending: '抵达门前' } : { text: '  第二章作者全文。\n' }
    const target = { id: `${kind}-two`, workId: 'work-test', kind, chapter: 2, version: 1, humanStatus: 'pending', createdAt: '2026-09-29', content }
    const first = { ...target, id: `${kind}-one`, chapter: 1, humanStatus: 'approved' }
    let writes = 0; let reads = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (_url, init) => {
      if (init?.method === 'POST') { writes++; expect(JSON.parse(init.body as string).chapter).toBe(2); throw new Error('lost') }
      reads++
      return new Response(JSON.stringify({ id: 'work-test', seed: '素材', title: '测试', config: {}, createdAt: '2026-09-29',
        artifacts: [first, { ...target, humanStatus: writes ? 'approved' : 'pending' }],
        workflowState: writes ? `${kind}-approved` : `awaiting-${kind}-review`, nextStepId: null, allowedActions: [],
      }))
    } })
    const input = { chapter: 2, expectedArtifactId: target.id, expectedHeadVersion: 1, content }
    const result = kind === 'beat' ? await commands.runBeatCommand(client, 'work-test', 'approve-beat', input) : await commands.runProseCommand(client, 'work-test', 'approve-prose', input)
    expect(result).toMatchObject({ artifact: { id: target.id, chapter: 2, content }, confirmedBy: 'read-work' })
    expect(writes).toBe(1); expect(reads).toBe(2)
  })
})
