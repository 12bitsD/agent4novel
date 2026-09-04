import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingArtifactSchema, type SettingApproveRequest } from '@agent4novel/contracts'
import { confirmSettingApproval, finishSettingApproval, postSettingApproval } from '../src/setting-api.js'
import { initSettingReview, reduceSettingReview } from '../src/setting-review.js'
import { getWork } from '../src/api.js'

const content = {
  overview: '总览', world: [{ itemId: 'w1', title: '世界', content: '世界内容' }],
  characters: [{ itemId: 'c1', title: '人物', content: '人物内容' }], factions: [], relationships: [], extensions: [],
}
const pending = settingArtifactSchema.parse({ id: 'a1', workId: 'w1', kind: 'setting', version: 1, humanStatus: 'pending', createdAt: 'today', content })
const request: SettingApproveRequest = { content, expectedHeadVersion: 1 }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Setting HTTP 传输边界', () => {
  it('工作台读取必须符合共享 WorkView；缺 nextStepId 的旧响应不能驱动页面生成', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'w1', title: '作品', seed: '脑洞', config: {}, createdAt: 'today', artifacts: [], workflowState: 'ready-to-generate', allowedActions: ['generate'] }))))
    await expect(getWork('w1')).rejects.toThrow()
  })
  it('有效 422 拒绝保留可编辑草稿，非法错误或 200 响应不能宣称成功', async () => {
    const state = reduceSettingReview(initSettingReview(pending), { type: 'submit' })
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'invalid-content', retryable: false, message: '标题为空', issues: [{ path: ['content', 'world', 0, 'title'], code: 'custom', message: '标题为空' }] }), { status: 422 }))
    vi.stubGlobal('fetch', fetcher)
    const rejected = await finishSettingApproval(state)
    expect(rejected.state.phase).toBe('editing')
    expect(rejected.state.hasUnknownWrite).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('offline'))
    const unknown = await finishSettingApproval(state)
    expect(unknown.state.phase).toBe('uncertain')
    expect(unknown.state.hasUnknownWrite).toBe(true)
  })
  it('确认 GET 响应体停滞在 10 秒后结束，不清除未知写入标记', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }))
    const state = reduceSettingReview(reduceSettingReview(initSettingReview(pending), { type: 'submit' }), { type: 'unknown', message: '超时' })
    let phase = ''
    void confirmSettingApproval(state).then((result) => { phase = result.state.phase })
    await vi.advanceTimersByTimeAsync(10_001)
    expect(phase).toBe('uncertain')
  })
  it('未知旧写入之后重试返回 409 仍回读一次，以已通过目标解除不确定状态', async () => {
    let state = reduceSettingReview(initSettingReview(pending), { type: 'submit' })
    state = reduceSettingReview(state, { type: 'unknown', message: '超时' })
    state = reduceSettingReview(state, { type: 'readback-failed', message: '失败' })
    state = reduceSettingReview(state, { type: 'retry' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'artifact-already-approved', retryable: false, message: '已通过' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'w1', title: '作品', seed: '脑洞', config: {}, createdAt: 'today', artifacts: [{ ...pending, humanStatus: 'approved' }], workflowState: 'setting-approved', nextStepId: null, allowedActions: [] }))))
    expect((await finishSettingApproval(state)).state.phase).toBe('approved')
  })
  it('POST 响应丢失仅自动 GET 一次，匹配已通过内容即可确认；绝不自动重写', async () => {
    const work = { id: 'w1', title: '作品', seed: '脑洞', config: {}, createdAt: 'today', artifacts: [{ ...pending, humanStatus: 'approved' }], workflowState: 'setting-approved', nextStepId: null, allowedActions: [] }
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce(new Response(JSON.stringify(work)))
    vi.stubGlobal('fetch', fetcher)
    const state = reduceSettingReview(initSettingReview(pending), { type: 'submit' })
    const result = await finishSettingApproval(state)
    expect(result.state.phase).toBe('approved')
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/works/w1/artifacts/setting/approve', 'POST'], ['/api/works/w1', 'GET'],
    ])
  })
  it.each(['fetch', 'body'])('POST deadline 覆盖 %s 等待，即使底层忽略 abort 也结束等待', async (boundary) => {
    vi.useFakeTimers()
    const never = new Promise<never>(() => {})
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(boundary === 'fetch' ? never : Promise.resolve({ ok: true, status: 200, json: () => never })))
    let message = ''
    void postSettingApproval('w1', request).catch((error: Error) => { message = error.message })
    await vi.advanceTimersByTimeAsync(30_001)
    expect(message).toContain('超时')
  })
  it('只提交完整专用通过命令，并运行时验证 approved 成功响应', async () => {
    const remote = { ...pending, humanStatus: 'approved' }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(remote)))
    vi.stubGlobal('fetch', fetcher)
    expect(await postSettingApproval('w1', request)).toEqual(remote)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/works/w1/artifacts/setting/approve')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(request)
  })
})
