import type { ApiError, SettingArtifact, SettingApproveRequest, WorkView } from '@agent4novel/contracts'
import { apiErrorSchema, settingApproveResponseSchema, workViewSchema } from '@agent4novel/contracts'
import type { SettingReviewState } from './setting-review.js'
import { reduceSettingReview } from './setting-review.js'

class SettingRequestError extends Error {
  constructor(readonly status: number, readonly details: ApiError) { super(details.message) }
}
export async function confirmSettingApproval(state: SettingReviewState): Promise<{ state: SettingReviewState; work?: WorkView }> {
  try {
    const work = await withDeadline(10_000, async (signal) => {
      const response = await fetch(`/api/works/${encodeURIComponent(state.baseline.workId)}`, { signal })
      if (!response.ok) throw new Error('暂时无法读取服务器结果')
      const parsed = workViewSchema.parse(await response.json())
      if (parsed.id !== state.baseline.workId) throw new Error('服务器返回了不同作品')
      return parsed
    })
    return { state: reduceSettingReview(state, { type: 'readback', work }), work }
  } catch {
    return { state: reduceSettingReview(state, { type: 'readback-failed', message: '暂时无法确认服务器结果，请再次核对。' }) }
  }
}
export async function finishSettingApproval(state: SettingReviewState): Promise<{ state: SettingReviewState; work?: WorkView }> {
  if (state.phase !== 'submitting' || !state.submitted) return { state }
  let next: SettingReviewState
  try {
    const candidate = await postSettingApproval(state.baseline.workId, state.submitted.request)
    next = reduceSettingReview(state, { type: 'response', candidate })
  } catch (error) {
    next = error instanceof SettingRequestError && error.status >= 400 && error.status < 500
      ? reduceSettingReview(state, { type: 'rejected', status: error.status, error: error.details })
      : reduceSettingReview(state, { type: 'unknown', message: '通过结果尚未确认，正在核对服务器。' })
    if (error instanceof SettingRequestError && error.status === 409) return confirmSettingApproval(next)
  }
  return next.phase === 'reconciling' ? confirmSettingApproval(next) : { state: next }
}

async function withDeadline<T>(ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('请求超时，结果尚未确认')); controller.abort() }, ms)
  })
  try { return await Promise.race([task(controller.signal), deadline]) }
  finally { clearTimeout(timer) }
}

export async function postSettingApproval(workId: string, request: SettingApproveRequest): Promise<SettingArtifact> {
  return withDeadline(30_000, async (signal) => {
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}/artifacts/setting/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    })
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body)
      if (parsed.success) throw new SettingRequestError(response.status, parsed.data)
      throw new Error('服务器错误响应无法验证')
    }
    return settingApproveResponseSchema.parse(body)
  })
}
