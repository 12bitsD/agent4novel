import { advanceOutcomeDtoSchema, httpErrorSchema } from '@agent4novel/contracts'
import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'

const work = { id: 'w1', seed: '脑洞', title: '作品', config: {}, createdAt: 'today' }
const creative = { id: 'a1', workId: 'w1', kind: 'creative', version: 2, humanStatus: 'approved', createdAt: 'today',
  content: { directions: [{ directionId: 'dir1', title: '方向', hook: '钩子', synopsis: '梗概', tags: [], characters: [], setting: [], payoffs: [], outline: [] }] } }

describe('public HTTP response contracts', () => {
  it.each(['w1', 'other'])('does not treat an unknown or different-work command for %s as definite rejection', async workId => {
    const body = { code: 'version-conflict', message: 'check result', retryable: false, telemetry: [],
      command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'generate-beat',
        target: { workId, kind: 'beat', chapter: 2 }, expectedHead: null, executionMode: 'demo', latencyMs: 0,
        attemptIds: [], writeOutcome: 'unknown', failureStage: 'commit' } }
    const client = createClient({ baseUrl: 'http://test', fetch: async () => Response.json(body, { status: 409 }) })
    const error = await client.startChapter('w1', { chapter: 2, expectedPreviousProseId: 'p1', expectedPreviousProseVersion: 1 }).catch(value => value)
    expect(error.status).toBeUndefined()
    expect(error).toMatchObject({ code: workId === 'w1' ? 'version-conflict' : 'invalid-response', details: { writeOutcome: 'unknown' } })
  })
  it.each([
    ['list', [{ id: 'w1', title: '作品', seedPreview: '脑洞', chapterCount: -1 }]],
    ['create', { ...work, config: null }],
    ['select', { ...creative, workId: 'other' }],
    ['approve', { workId: 'other', stage: 'complete', nextStepId: null }],
  ] as const)('rejects malformed or wrong-resource %s success without replay', async (method, body) => {
    let calls = 0
    const client = createClient({ baseUrl: 'http://test', fetch: async () => { calls++; return Response.json(body) } })
    const operation = method === 'list' ? client.listWorks() : method === 'create' ? client.createWork({ seed: '脑洞' })
      : method === 'select' ? client.select('w1', 'dir1', 1) : client.approve('w1', 'outline')
    await expect(operation).rejects.toMatchObject({ code: 'invalid-response' })
    expect(calls).toBe(1)
  })
  it('treats a malformed write rejection as unknown and never replays', async () => {
    let calls = 0
    const client = createClient({ baseUrl: 'http://test', fetch: async () => { calls++; return Response.json({ code: 'invalid-input', message: 'broken envelope' }, { status: 400 }) } })
    await expect(client.select('w1', 'dir1', 1)).rejects.toMatchObject({ code: 'invalid-response', details: { writeOutcome: 'unknown' } })
    expect(calls).toBe(1)
  })
})

const startRequest = { chapter: 2, expectedPreviousProseId: 'p1', expectedPreviousProseVersion: 1 }
const startCommand = { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'generate-beat',
  target: { workId: 'w1', kind: 'beat', chapter: 2 }, expectedHead: null, executionMode: 'demo', latencyMs: 0,
  attemptIds: [], writeOutcome: 'not-committed', failureStage: 'precondition' }
const wrongCommands = [
  { ...startCommand, target: { ...startCommand.target, chapter: 3 } },
  { ...startCommand, operation: 'regenerate-beat', expectedHead: { artifactId: 'b1', version: 1 } },
  { ...startCommand, operation: 'generate-prose', target: { ...startCommand.target, kind: 'prose' } },
  { kind: 'request-rejected', requestId: startCommand.requestId, operation: 'approve-beat', executionMode: 'demo',
    latencyMs: 0, attemptIds: [], writeOutcome: 'not-committed', failureStage: 'request' },
]
function failureBody(command: typeof startCommand | typeof wrongCommands[number], status: number) {
  return status === 409 ? { code: command.kind === 'request-rejected' ? 'invalid-input' : 'version-conflict', message: 'check result', retryable: false, command }
    : { kind: 'failed', stepId: 'beat', code: 'version-conflict', retryable: false,
      state: { workId: 'w1', stage: 'ready', nextStepId: 'beat' }, telemetry: [],
      [command.operation.includes('prose') ? 'proseCommand' : 'beatCommand']: command }
}

describe('start-chapter command association', () => {
  it.each(wrongCommands.flatMap(command => [200, 409].map(status => ({ command, status }))))('keeps a mismatched $command.operation observation at HTTP $status unknown', async ({ command, status }) => {
    const body = failureBody(command, status)
    expect((status === 200 ? advanceOutcomeDtoSchema : httpErrorSchema).safeParse(body).success).toBe(true)
    let calls = 0
    const client = createClient({ baseUrl: 'http://test', fetch: async () => { calls++; return Response.json(body, { status }) } })
    const error = await client.startChapter('w1', startRequest).catch(value => value)
    expect(error).toMatchObject({ code: 'invalid-response', details: { writeOutcome: 'unknown' } })
    expect(error.status).toBeUndefined()
    expect(calls).toBe(1)
  })
  it.each([true, false])('accepts an associated error or a base error (command: %s)', async hasCommand => {
    const body = { code: 'version-conflict', message: 'check result', retryable: false, ...(hasCommand ? { command: startCommand } : {}) }
    const client = createClient({ baseUrl: 'http://test', fetch: async () => Response.json(body, { status: 409 }) })
    await expect(client.startChapter('w1', startRequest)).rejects.toMatchObject({ code: 'version-conflict', status: 409 })
  })
  it('accepts an idempotent response without a command', async () => {
    const body = { kind: 'awaiting-approval', state: { workId: 'w1', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'beat', chapter: 2 } }, telemetry: [] }
    const client = createClient({ baseUrl: 'http://test', fetch: async () => Response.json(body) })
    await expect(client.startChapter('w1', startRequest)).resolves.toEqual(body)
  })
})
