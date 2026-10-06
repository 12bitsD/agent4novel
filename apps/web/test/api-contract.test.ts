import { advanceOutcomeDtoSchema, httpErrorSchema } from '@agent4novel/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWork, getWork, listWorks, saveCreativeDraft, saveOutlineDraft, selectCreativeDirection, startChapter } from '../src/api.js'

afterEach(() => vi.unstubAllGlobals())
const work = { id: 'w1', seed: '脑洞', title: '作品', config: {}, createdAt: 'today', artifacts: [],
  workflowState: 'ready-to-generate', allowedActions: ['generate'], nextStepId: 'caption', currentChapter: 1, chapters: [] }
const creative = { id: 'a1', workId: 'other', kind: 'creative', version: 2, humanStatus: 'approved', createdAt: 'today',
  content: { directions: [{ directionId: 'dir1', title: '方向', hook: '钩子', synopsis: '梗概', tags: [], characters: [], setting: [], payoffs: [], outline: [] }] } }

describe('Web public HTTP contracts', () => {
  it('does not treat a different-work command error as this work being rejected', async () => {
    const body = { code: 'version-conflict', message: 'other work', retryable: false, telemetry: [],
      command: { kind: 'execution-result', requestId: '11111111-1111-4111-8111-111111111111', operation: 'generate-beat',
        target: { workId: 'other', kind: 'beat', chapter: 2 }, expectedHead: null, executionMode: 'demo', latencyMs: 0,
        attemptIds: [], writeOutcome: 'not-committed', failureStage: 'precondition' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 409 })))
    const error = await startChapter('w1', { chapter: 2, expectedPreviousProseId: 'p1', expectedPreviousProseVersion: 1 }).catch(value => value)
    expect(error).toMatchObject({ code: 'invalid-response', writeOutcome: 'unknown' })
    expect(error.status).toBeUndefined()
  })
  it.each([
    ['list', [{ id: 'w1', title: '作品', seedPreview: '脑洞', chapterCount: -1 }]],
    ['create', { ...work, config: null }],
    ['get', { ...work, id: 'other' }],
    ['select', creative],
  ] as const)('rejects invalid or wrong-resource %s without replay', async (operation, body) => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(body))
    vi.stubGlobal('fetch', fetcher)
    const promise = operation === 'list' ? listWorks() : operation === 'create' ? createWork({ seed: '脑洞' })
      : operation === 'get' ? getWork('w1') : selectCreativeDirection('w1', 'dir1', 1)
    await expect(promise).rejects.toMatchObject({ code: 'invalid-response' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    [400, JSON.stringify({ code: 'invalid-input', message: 'incomplete' })],
    [409, '<html>proxy</html>'],
    [200, '<html>proxy</html>'],
  ] as const)('does not classify malformed %s write responses as definite rejection', async (status, body) => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(body, { status }))
    vi.stubGlobal('fetch', fetcher)
    const error = await startChapter('w1', { chapter: 2, expectedPreviousProseId: 'p1', expectedPreviousProseVersion: 1 }).catch(value => value)
    expect(error).toMatchObject({ code: 'invalid-response', writeOutcome: 'unknown' })
    expect(error.status).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
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
    const fetcher = vi.fn().mockImplementation(async () => Response.json(body, { status }))
    vi.stubGlobal('fetch', fetcher)
    const error = await startChapter('w1', startRequest).catch(value => value)
    expect(error).toMatchObject({ code: 'invalid-response', writeOutcome: 'unknown' })
    expect(error.status).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([true, false])('accepts an associated error or a base error (command: %s)', async hasCommand => {
    const body = { code: 'version-conflict', message: 'check result', retryable: false, ...(hasCommand ? { command: startCommand } : {}) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 409 })))
    await expect(startChapter('w1', startRequest)).rejects.toMatchObject({ code: 'version-conflict', status: 409 })
  })
  it('accepts an idempotent response without a command', async () => {
    const body = { kind: 'awaiting-approval', state: { workId: 'w1', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'beat', chapter: 2 } }, telemetry: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    await expect(startChapter('w1', startRequest)).resolves.toEqual(body)
  })
})

const outlineDraft = { arcs: [1, 2, 3].map(i => ({ title: '弧线' + i, conflict: '冲突', development: '发展', resolution: '局势', segments: [1, 2].map(j => ({ title: '点' + j, summary: '行动', outcome: '落点' })) })) }
const legacyWrites = [
  ['creative-save', () => saveCreativeDraft('w1', creative.content, 1)],
  ['creative-select', () => selectCreativeDirection('w1', 'dir1', 1)],
  ['outline-save', () => saveOutlineDraft('w1', outlineDraft, 1)],
] as const

describe('legacy material write receipt boundaries', () => {
  it.each(legacyWrites)('%s keeps a foreign command error unknown without retry', async (_name, command) => {
    const body = { code: 'version-conflict', message: 'different operation', retryable: false, command: startCommand }
    expect(httpErrorSchema.safeParse(body).success).toBe(true)
    const transport = vi.fn().mockResolvedValue(Response.json(body, { status: 409 }))
    vi.stubGlobal('fetch', transport)
    await expect(command()).rejects.toMatchObject({ code: 'invalid-response', writeOutcome: 'unknown' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it.each(legacyWrites)('%s stops waiting for a hung response at30s without replay', async (_name, command) => {
    vi.useFakeTimers()
    const transport = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', transport)
    try {
      let settled = false
      const outcome = command().catch(error => error).then(error => { settled = true; return error })
      await vi.advanceTimersByTimeAsync(30_001)
      expect(settled).toBe(true)
      expect((await outcome).message).toContain('结果尚未确认')
      expect(transport).toHaveBeenCalledTimes(1)
      const signal = (transport.mock.calls[0] as unknown as [string, RequestInit])[1].signal
      expect(signal?.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
