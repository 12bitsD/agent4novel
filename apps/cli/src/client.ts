import { advanceOutcomeDtoSchema, apiErrorSchema, settingApproveResponseSchema, workViewSchema } from '@agent4novel/contracts'
import type {
  Artifact,
  ArtifactKind,
  LlmTelemetry,
  OutlineDraft,
  SettingApproveRequest,
  ValidationIssue,
  Work,
  WorkSummary,
  WorkView,
} from '@agent4novel/contracts'

// 普通 REST 请求沿用 300s；advance 可能串行执行多个 LLM step，单独覆盖当前最长两步链：
// 2 * server 900s 上限 + 20s 余量。显式 CLI override 仍统一覆盖两类请求。
export const DEFAULT_CLI_TIMEOUT_MS = 300_000
export const DEFAULT_ADVANCE_TIMEOUT_MS = 1_820_000
const MIN_CLI_TIMEOUT_MS = 1_000
const MAX_CLI_TIMEOUT_MS = 3_600_000

// CLI 侧统一错误:HTTP 错误的 {code, retryable, attemptId, message} 原样带上,Agent 可读
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryable = false,
    readonly attemptId?: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type Client = ReturnType<typeof createClient>

export function parseCliTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (
    raw.trim() === '' ||
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_CLI_TIMEOUT_MS ||
    parsed > MAX_CLI_TIMEOUT_MS
  ) {
    throw new CliError(
      'CLI timeout must be an integer between 1000 and 3600000 milliseconds',
      'usage',
    )
  }
  return parsed
}

// 薄封装 server REST(#14):供 CLI 与测试共用;fetch 可注入以便单测
export function createClient(opts: { baseUrl: string; fetch?: FetchLike; timeoutMs?: number }) {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const fetchImpl = opts.fetch ?? fetch
  const timeoutOverrideMs =
    opts.timeoutMs === undefined ? undefined : parseCliTimeoutMs(String(opts.timeoutMs))

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    defaultTimeoutMs = DEFAULT_CLI_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new CliError('Request timed out; a submitted write may still complete on the server', 'network-error'))
      }, timeoutOverrideMs ?? defaultTimeoutMs)
    })
    const perform = async (): Promise<T> => {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const parsed = apiErrorSchema.safeParse(data)
        if (!parsed.success) throw new CliError('Invalid server error response', 'invalid-response', res.status)
        const e = parsed.data
        throw new CliError(e.message, e.code, res.status, e.retryable, e.attemptId, e.issues)
      }
      return data as T
    }
    try {
      return await Promise.race([perform(), deadline])
    } catch (error) {
      if (error instanceof CliError) throw error
      throw new CliError('Request could not be completed; a submitted write may still complete on the server', 'network-error')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    listWorks: () => call<WorkSummary[]>('GET', '/api/works'),
    createWork: (input: { seed: string; title?: string }) =>
      call<Work>('POST', '/api/works', input),
    getWork: async (workId: string): Promise<WorkView> => {
      const data = await call<unknown>('GET', `/api/works/${workId}`)
      const parsed = workViewSchema.safeParse(data)
      if (!parsed.success || parsed.data.id !== workId) {
        throw new CliError('Invalid work response', 'invalid-response', 200)
      }
      return parsed.data
    },
    advance: async (workId: string) => {
      const data = await call<unknown>('POST', `/api/works/${workId}/advance`, undefined, DEFAULT_ADVANCE_TIMEOUT_MS)
      const parsed = advanceOutcomeDtoSchema.safeParse(data)
      if (!parsed.success || parsed.data.state.workId !== workId) {
        throw new CliError('Invalid advance response', 'invalid-response', 200)
      }
      return parsed.data
    },
    select: (workId: string, directionId: string, expectedHeadVersion: number) =>
      call<Artifact>('POST', `/api/works/${workId}/artifacts/creative/select`, {
        directionId,
        expectedHeadVersion,
      }),
    saveOutline: (workId: string, content: OutlineDraft, expectedHeadVersion: number) =>
      call<Artifact>('PUT', `/api/works/${workId}/artifacts/outline`, {
        content,
        expectedHeadVersion,
      }),
    approve: (workId: string, kind: ArtifactKind) =>
      call<unknown>('POST', `/api/works/${workId}/approve`, { kind }),
    approveSetting: async (workId: string, request: SettingApproveRequest) => {
      const data = await call<unknown>('POST', `/api/works/${workId}/artifacts/setting/approve`, request)
      const parsed = settingApproveResponseSchema.safeParse(data)
      if (!parsed.success || parsed.data.workId !== workId) {
        throw new CliError('Invalid setting approval response', 'invalid-response', 200)
      }
      return parsed.data
    },
    // LLM 遥测回看(#14)
    getTelemetry: (workId: string) =>
      call<{ workId: string; telemetry: LlmTelemetry[] }>('GET', `/api/works/${workId}/telemetry`),
  }
}
