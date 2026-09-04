import { describe, expect, it, vi } from 'vitest'
import type { Artifact, SettingApproveRequest, SettingArtifact, WorkView } from '@agent4novel/contracts'
import { settingApproveRequestSchema } from '@agent4novel/contracts'
import { createClient } from '../src/client.js'
import * as cmd from '../src/commands.js'

const baseline: SettingArtifact = {
  id: 'setting-1', workId: 'w1', kind: 'setting', version: 1, humanStatus: 'pending', createdAt: 'created-once',
  content: {
    overview: '生成的总览',
    world: [{ itemId: 'item-world', title: '故事世界', content: '一座现实城市' }],
    characters: [{ itemId: 'item-person', title: '主要人物', content: '一个普通人' }],
    factions: [], relationships: [], extensions: [],
  },
}
const request: SettingApproveRequest = {
  expectedHeadVersion: 1,
  content: { ...baseline.content, overview: '**作者修改后的总览**' },
}
const approved: SettingArtifact = { ...baseline, humanStatus: 'approved', content: request.content as SettingArtifact['content'] }
const workWith = (artifact: SettingArtifact): WorkView => ({
  id: 'w1', title: '测试作品', seed: '合成素材', config: {}, createdAt: 'created-once', artifacts: [artifact],
  workflowState: artifact.humanStatus === 'approved' ? 'setting-approved' : 'awaiting-setting-review',
  nextStepId: null, allowedActions: artifact.humanStatus === 'approved' ? [] : ['approve'],
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('setting CLI submission', () => {
  it('reads the pending baseline and approves the complete request with its explicit version', async () => {
    const calls: { method: string; path: string; body: unknown }[] = []
    const client = createClient({ baseUrl: 'http://x', fetch: async (url, init) => {
      calls.push({ method: init!.method!, path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return init?.method === 'GET' ? json(workWith(baseline)) : json(approved)
    } })

    await expect(cmd.approveSetting(client, 'w1', request)).resolves.toEqual(approved)
    expect(calls).toEqual([
      { method: 'GET', path: '/api/works/w1', body: undefined },
      { method: 'POST', path: '/api/works/w1/artifacts/setting/approve', body: request },
    ])
  })

  it('confirms a committed request after losing the response with one read and no repeat write', async () => {
    const calls: string[] = []
    let current = baseline
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      if (init?.method === 'GET') return json(workWith(current))
      current = approved
      throw new Error('response lost after server commit')
    } })

    await expect(cmd.approveSetting(client, 'w1', request)).resolves.toEqual(approved)
    expect(calls).toEqual(['GET', 'POST', 'GET'])
    expect(request.expectedHeadVersion).toBe(1)
  })

  it('does not claim historical success or post again when a new invocation reads an approved setting', async () => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      return init?.method === 'GET' ? json(workWith(approved)) : json(approved)
    } })
    await expect(cmd.approveSetting(client, 'w1', request)).rejects.toMatchObject({ code: 'artifact-already-approved' })
    expect(calls).toEqual(['GET'])
  })

  it('keeps a stale file version and rejects it without silently substituting the latest head', async () => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      return init?.method === 'GET' ? json(workWith({ ...baseline, version: 2 })) : json(approved)
    } })
    const stale = structuredClone(request)
    await expect(cmd.approveSetting(client, 'w1', stale)).rejects.toMatchObject({ code: 'version-conflict' })
    expect(stale.expectedHeadVersion).toBe(1)
    expect(calls).toEqual(['GET'])
  })

  it('redirects the generic approve setting command to its dedicated full-content command', async () => {
    const fetch = vi.fn(async () => json({ stage: 'complete' }))
    const client = createClient({ baseUrl: 'http://x', fetch })
    await expect(cmd.approve(client, 'w1', 'setting')).rejects.toMatchObject({ code: 'setting-approval-required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves structured 422 issues without rereading or changing the request', async () => {
    const issues = [{ path: ['content', 'world', 0, 'itemId'], code: 'custom', message: '身份不属于本作品' }]
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      return init?.method === 'GET' ? json(workWith(baseline))
        : json({ code: 'invalid-content', message: '请检查设定', retryable: false, issues }, 422)
    } })
    await expect(cmd.approveSetting(client, 'w1', request)).rejects.toMatchObject({ code: 'invalid-content', status: 422, issues })
    expect(calls).toEqual(['GET', 'POST'])
  })

  it.each([
    ['approve', 'fetch'], ['approve', 'body'], ['get', 'fetch'], ['get', 'body'],
  ])('ends a never-settling setting %s %s request at its deadline', async (operation, stuck) => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const client = createClient({ baseUrl: 'http://x', timeoutMs: 1_000, fetch: async (_url, init) => {
        signal = init?.signal ?? undefined
        if (stuck === 'fetch') return new Promise<Response>(() => {})
        return new Response(new ReadableStream({ start() {} }))
      } })
      const pending = operation === 'approve' ? client.approveSetting('w1', request) : client.getWork('w1')
      const outcome = pending.then(() => 'resolved', (error: unknown) => error)
      await vi.advanceTimersByTimeAsync(1_001)
      const result = await Promise.race([outcome, Promise.resolve('still waiting')])
      expect(result).toMatchObject({ code: 'network-error' })
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('smoke follows the complete fake HTTP chain, edits the pending setting, and verifies the committed result', async () => {
    let current: WorkView = {
      ...workWith(baseline), artifacts: [], workflowState: 'ready-to-generate', allowedActions: ['generate'], nextStepId: 'caption',
    }
    const calls: string[] = []
    let advances = 0
    let submitted: SettingApproveRequest | undefined
    const client = createClient({ baseUrl: 'http://x', fetch: async (url, init) => {
      const path = new URL(url).pathname
      const method = init!.method!
      calls.push(`${method} ${path}`)
      if (method === 'GET') return json(current)
      if (path === '/api/works') return json({ id: 'w1', title: '测试作品', seed: '合成素材', config: {}, createdAt: 'created-once' }, 201)
      if (path.endsWith('/advance')) {
        const kind = (['creative', 'outline', 'setting'] as const)[advances++]!
        const artifact: Artifact = kind === 'setting' ? baseline : {
          id: `artifact-${kind}`, workId: 'w1', kind, version: 1, humanStatus: 'pending' as const, createdAt: 'created-once',
          content: kind === 'creative' ? { directions: [{ directionId: 'direction-one' }] } : { arcs: [] },
        }
        current = {
          ...current, artifacts: [...current.artifacts, artifact], nextStepId: null,
          workflowState: kind === 'creative' ? 'awaiting-selection' : kind === 'outline' ? 'awaiting-outline-review' : 'awaiting-setting-review',
          allowedActions: kind === 'creative' ? ['select'] : ['approve'],
        }
        return json({ kind: 'advanced', stepId: kind, state: { workId: 'w1', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind } }, telemetry: [] })
      }
      if (path.endsWith('/select') || path === '/api/works/w1/approve') {
        const kind = path.endsWith('/select') ? 'creative' : 'outline'
        current = { ...current, artifacts: current.artifacts.map((artifact) => artifact.kind === kind ? { ...artifact, humanStatus: 'approved' } : artifact), workflowState: 'ready-to-generate', nextStepId: kind === 'creative' ? 'outline' : 'setting', allowedActions: ['generate'] }
        return json(path.endsWith('/select') ? current.artifacts.find((artifact) => artifact.kind === kind) : { workId: 'w1', stage: 'ready', nextStepId: 'setting' })
      }
      if (path.endsWith('/artifacts/setting/approve')) {
        submitted = settingApproveRequestSchema.parse(JSON.parse(String(init?.body)))
        const artifact: SettingArtifact = { ...baseline, humanStatus: 'approved', content: submitted.content as SettingArtifact['content'] }
        current = { ...current, artifacts: current.artifacts.map((entry) => entry.kind === 'setting' ? artifact : entry), workflowState: 'setting-approved', nextStepId: null, allowedActions: [] }
        return json(artifact)
      }
      throw new Error(`Unexpected fake request ${method} ${path}`)
    } })

    const result = await cmd.smoke(client, { seed: '合成素材' }, () => {})
    expect(result.final.workflowState).toBe('setting-approved')
    expect(submitted?.expectedHeadVersion).toBe(1)
    expect(submitted?.content.overview).not.toBe(baseline.content.overview)
    expect(result.final.artifacts.find((artifact) => artifact.kind === 'setting')?.content).toEqual(submitted?.content)
    expect(calls).toEqual([
      'POST /api/works', 'POST /api/works/w1/advance', 'GET /api/works/w1',
      'POST /api/works/w1/artifacts/creative/select', 'POST /api/works/w1/advance', 'POST /api/works/w1/approve',
      'POST /api/works/w1/advance', 'GET /api/works/w1', 'GET /api/works/w1',
      'POST /api/works/w1/artifacts/setting/approve', 'GET /api/works/w1',
    ])
  })

  it('smoke stops at a failed HTTP-200 advance instead of continuing the chain', async () => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://x', fetch: async (url, init) => {
      calls.push(`${init?.method} ${new URL(url).pathname}`)
      if (new URL(url).pathname === '/api/works') return json({ id: 'w1', title: 't', seed: 's', config: {}, createdAt: 'created-once' })
      if (new URL(url).pathname.endsWith('/advance')) return json({
        kind: 'failed', stepId: 'creative', code: 'llm-timeout', retryable: true, attemptId: 'attempt-1',
        state: { workId: 'w1', stage: 'ready', nextStepId: 'creative' }, telemetry: [],
      })
      return json(workWith(baseline))
    } })
    await expect(cmd.smoke(client, { seed: '合成素材' }, () => {})).rejects.toMatchObject({ code: 'llm-timeout', retryable: true, attemptId: 'attempt-1' })
    expect(calls).toEqual(['POST /api/works', 'POST /api/works/w1/advance'])
  })

  it.each(['conflict', 'invalid-success', 'malformed-error'])('reconciles %s once when the server has the submitted result', async (response) => {
    const calls: string[] = []
    let written = false
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      if (init?.method === 'GET') return json(workWith(written ? approved : baseline))
      written = true
      if (response === 'conflict') return json({ code: 'artifact-already-approved', message: '已通过', retryable: false }, 409)
      if (response === 'invalid-success') return json({ ok: true })
      return new Response('not an API error envelope', { status: 422 })
    } })
    await expect(cmd.approveSetting(client, 'w1', request)).resolves.toEqual(approved)
    expect(calls).toEqual(['GET', 'POST', 'GET'])
  })

  it.each(['pending', 'failed-read'])('does not treat an unknown write followed by %s as successful or retry automatically', async (read) => {
    const calls: string[] = []
    const original = JSON.stringify(request)
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      if (calls.length === 1) return json(workWith(baseline))
      if (init?.method === 'POST' || read === 'failed-read') throw new Error('disconnected')
      return json(workWith(baseline))
    } })
    await expect(cmd.approveSetting(client, 'w1', request)).rejects.toMatchObject({ code: 'setting-result-unknown' })
    expect(calls).toEqual(['GET', 'POST', 'GET'])
    expect(JSON.stringify(request)).toBe(original)
  })

  it('preserves the explicit rejection when its confirming read is still pending', async () => {
    const calls: string[] = []
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      calls.push(init!.method!)
      if (init?.method === 'GET') return json(workWith(baseline))
      return json({ code: 'setting-gate-not-ready', message: '先通过上游', retryable: false }, 409)
    } })
    await expect(cmd.approveSetting(client, 'w1', request)).rejects.toMatchObject({ code: 'setting-gate-not-ready' })
    expect(calls).toEqual(['GET', 'POST', 'GET'])
  })

  it('does not equate a retained old card with a requested same-text replacement', async () => {
    const replacement: SettingApproveRequest = {
      ...request,
      content: { ...request.content, world: [{ title: '故事世界', content: '一座现实城市' }] },
    }
    let reads = 0
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      if (init?.method === 'GET') return json(workWith(reads++ === 0 ? baseline : approved))
      throw new Error('lost response')
    } })
    await expect(cmd.approveSetting(client, 'w1', replacement)).rejects.toMatchObject({ code: 'setting-conflict' })
  })

  it('can confirm a newly created card whose server ID was absent from the pending baseline', async () => {
    const replacement: SettingApproveRequest = {
      ...request,
      content: { ...request.content, world: [{ title: '故事世界', content: '一座现实城市' }] },
    }
    const withNewId: SettingArtifact = {
      ...approved, content: { ...approved.content, world: [{ itemId: 'new-world-id', title: '故事世界', content: '一座现实城市' }] },
    }
    let reads = 0
    const client = createClient({ baseUrl: 'http://x', fetch: async (_url, init) => {
      if (init?.method === 'GET') return json(workWith(reads++ === 0 ? baseline : withNewId))
      throw new Error('lost response')
    } })
    await expect(cmd.approveSetting(client, 'w1', replacement)).resolves.toEqual(withNewId)
  })

  it('refuses a file that omits expectedHeadVersion before any network access', async () => {
    const fetch = vi.fn(async () => json(workWith(baseline)))
    const client = createClient({ baseUrl: 'http://x', fetch })
    await expect(cmd.approveSetting(client, 'w1', { content: request.content })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
