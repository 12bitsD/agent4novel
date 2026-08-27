import type {
  Artifact,
  ArtifactKind,
  LlmTelemetry,
  OutlineDraft,
  Work,
  WorkSummary,
  WorkView,
} from '@agent4novel/contracts'

// advance 是同步长请求(caption+creative 链式可达分钟级),默认 300s
const DEFAULT_TIMEOUT_MS = 300_000

// CLI 侧统一错误:HTTP 错误的 {code, retryable, attemptId, message} 原样带上,Agent 可读
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryable = false,
    readonly attemptId?: string,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type Client = ReturnType<typeof createClient>

// 薄封装 server REST(#14):供 CLI 与测试共用;fetch 可注入以便单测
export function createClient(opts: { baseUrl: string; fetch?: FetchLike; timeoutMs?: number }) {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const fetchImpl = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new CliError(err instanceof Error ? err.message : String(err), 'network-error')
    }
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const e = (data ?? {}) as { code?: string; message?: string; retryable?: boolean; attemptId?: string }
      throw new CliError(
        e.message ?? `HTTP ${res.status}`,
        e.code ?? 'http-error',
        res.status,
        e.retryable ?? false,
        e.attemptId,
      )
    }
    return data as T
  }

  return {
    listWorks: () => call<WorkSummary[]>('GET', '/api/works'),
    createWork: (input: { seed: string; title?: string }) =>
      call<Work>('POST', '/api/works', input),
    getWork: (workId: string) => call<WorkView>('GET', `/api/works/${workId}`),
    advance: (workId: string) => call<unknown>('POST', `/api/works/${workId}/advance`),
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
    // LLM 遥测回看(#14)
    getTelemetry: (workId: string) =>
      call<{ workId: string; telemetry: LlmTelemetry[] }>('GET', `/api/works/${workId}/telemetry`),
  }
}
