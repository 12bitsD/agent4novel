import { describe, expect, it, vi } from 'vitest'
import { CliError, createClient, parseCliTimeoutMs } from '../src/client.js'
import * as cmd from '../src/commands.js'

// 假 fetch:按 method+path 路由到预置响应,同时记录调用序列
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const key = `${init?.method ?? 'GET'} ${u.pathname}`
    calls.push({ method: init?.method ?? 'GET', path: u.pathname, body: init?.body ? JSON.parse(init.body as string) : undefined })
    const r = routes[key]
    if (!r) return new Response(JSON.stringify({ code: 'not-found', message: key }), { status: 404 })
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  return { fn, calls }
}

const workView = {
  id: 'w1',
  title: 't',
  seed: 's',
  config: {},
  createdAt: 'x',
  artifacts: [
    { id: 'a1', workId: 'w1', kind: 'creative', version: 3, content: { directions: [{ directionId: 'w1-dir-1' }] }, humanStatus: 'pending', createdAt: 'x' },
    { id: 'a2', workId: 'w1', kind: 'outline', version: 7, content: { arcs: [] }, humanStatus: 'pending', createdAt: 'x' },
  ],
  workflowState: 'awaiting-selection',
  allowedActions: ['select'],
}

describe('cli client/commands(#14)', () => {
  it('普通请求默认 300s 超时，只有 advance 默认等待 1820s', async () => {
    const signalTimeouts = new WeakMap<AbortSignal, number>()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const signal = new AbortController().signal
      signalTimeouts.set(signal, milliseconds)
      return signal
    })
    try {
      const observed: number[] = []
      const observingFetch = async (_url: string, init?: RequestInit): Promise<Response> => {
        observed.push(signalTimeouts.get(init?.signal as AbortSignal)!)
        return new Response('{}')
      }
      const client = createClient({ baseUrl: 'http://x', fetch: observingFetch })

      await client.listWorks()
      await client.advance('w1')

      expect(observed).toEqual([300_000, 1_820_000])
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('select 自动回填 creative headVersion', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/works/w1': { body: workView },
      'POST /api/works/w1/artifacts/creative/select': { body: { kind: 'creative', version: 4 } },
    })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    await cmd.select(client, 'w1', 'w1-dir-1')
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: '/api/works/w1/artifacts/creative/select',
      body: { directionId: 'w1-dir-1', expectedHeadVersion: 3 },
    })
  })

  it('select 缺省 directionId 取第一个方向', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/works/w1': { body: workView },
      'POST /api/works/w1/artifacts/creative/select': { body: {} },
    })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    await cmd.select(client, 'w1')
    expect(calls[1]?.body).toMatchObject({ directionId: 'w1-dir-1', expectedHeadVersion: 3 })
  })

  it('save-outline 自动回填 outline headVersion', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/works/w1': { body: workView },
      'PUT /api/works/w1/artifacts/outline': { body: { kind: 'outline', version: 8 } },
    })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    const draft = { arcs: [] } as never
    await cmd.saveOutline(client, 'w1', draft)
    expect(calls[1]?.body).toMatchObject({ content: { arcs: [] }, expectedHeadVersion: 7 })
  })

  it('get --kind 只取该产物;缺产物报 artifact-not-found', async () => {
    const { fn } = fakeFetch({ 'GET /api/works/w1': { body: workView } })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    const outline = await cmd.get(client, 'w1', 'outline')
    expect(outline).toMatchObject({ kind: 'outline', version: 7 })
    await expect(cmd.get(client, 'w1', 'caption')).rejects.toMatchObject({ code: 'artifact-not-found' })
  })

  it('校验 CLI timeout，并把 HTTP 错误映射成 CliError', async () => {
    expect(parseCliTimeoutMs(undefined)).toBeUndefined()
    expect(parseCliTimeoutMs('610000')).toBe(610_000)
    expect(() => parseCliTimeoutMs('forever')).toThrow(
      expect.objectContaining({ code: 'usage' }),
    )

    const { fn } = fakeFetch({
      'POST /api/works/w1/advance': {
        status: 503,
        body: { code: 'llm-unavailable', message: 'down', retryable: true, attemptId: 'att-1' },
      },
    })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    const err = await cmd.advance(client, 'w1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CliError)
    expect(err).toMatchObject({ code: 'llm-unavailable', retryable: true, attemptId: 'att-1' })
  })

  it('smoke 按序走完 create→advance→select→advance→approve→get', async () => {
    const created = { id: 'w9', title: 't', seed: 's', config: {}, createdAt: 'x' }
    const afterCreate = { ...workView, id: 'w9', artifacts: workView.artifacts.map((a) => ({ ...a, workId: 'w9' })) }
    const { fn, calls } = fakeFetch({
      'POST /api/works': { status: 201, body: created },
      'POST /api/works/w9/advance': { body: { kind: 'advanced', stepId: 'creative' } },
      'GET /api/works/w9': { body: { ...afterCreate, workflowState: 'outline-approved' } },
      'POST /api/works/w9/artifacts/creative/select': { body: { kind: 'creative', version: 4, humanStatus: 'approved' } },
      'POST /api/works/w9/approve': { body: { stage: 'complete' } },
    })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    const result = await cmd.smoke(client, { seed: 's' }, () => {})
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/works',
      'POST /api/works/w9/advance',
      'GET /api/works/w9', // select 缺省方向:先取快照
      'POST /api/works/w9/artifacts/creative/select',
      'POST /api/works/w9/advance',
      'POST /api/works/w9/approve',
      'GET /api/works/w9',
    ])
    expect(result.steps).toHaveLength(6)
    expect(result.final.workflowState).toBe('outline-approved')
  })

  it('logs 透传遥测查询端点', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/works/w1/telemetry': { body: { workId: 'w1', telemetry: [{ stepId: 'outline', ok: true }] } },
    })
    const client = createClient({ baseUrl: 'http://x', fetch: fn })
    const r = await cmd.logs(client, 'w1')
    expect(calls[0]?.path).toBe('/api/works/w1/telemetry')
    expect(r.telemetry).toHaveLength(1)
  })
})
