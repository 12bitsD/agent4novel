import { advanceOutcomeDtoSchema, httpErrorSchema, artifactSchema, workSchema, workListResponseSchema, pipelineStateSchema, settingApproveResponseSchema, workViewSchema, diagnosticResponseSchema, diagnosticQuerySchema } from '@agent4novel/contracts'
import type { BeatSubmission, ProseSubmission, DiagnosticQuery, StartChapterRequest, WorkCreateRequest, SelectCreativeRequest, OutlineDraftRequest, ApproveRequest } from '@agent4novel/contracts'
import { appConfigSchema, matchesStartChapterResponse } from '@agent4novel/contracts'
import { agentFileSchema, agentFileReadSchema, agentFileUploadSchema, authorConfigViewSchema, authorConfigReceiptSchema, authorConfigSaveSchema,
  managedAgentFileText, type AuthorConfigSave, type AgentFileUpload } from '@agent4novel/contracts'
import { createHash } from 'node:crypto'
import { badExampleRequestSchema, badExampleSchema, badExamplePageSchema, badExampleQuerySchema, matchesBadExample,
  type BadExampleRequest, type BadExampleQuery } from '@agent4novel/contracts'
import type {
  ArtifactKind,
  OutlineDraft,
  SettingApproveRequest,
  ValidationIssue,
  Work,
  WorkSummary,
  WorkView,
  HttpError,
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
    readonly details?: Record<string, unknown>,
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

  function invalidResponse(write: boolean): CliError {
    return new CliError('Invalid server response; inspect the work before retrying a write', 'invalid-response', undefined,
      false, undefined, undefined, write ? { writeOutcome: 'unknown' } : undefined)
  }
  function validate<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } },
    data: unknown, matches: (result: T) => boolean = () => true, write = false): T {
    const parsed = schema.safeParse(data)
    if (!parsed.success || !matches(parsed.data)) throw invalidResponse(write)
    return parsed.data
  }

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    defaultTimeoutMs = DEFAULT_CLI_TIMEOUT_MS,
    raw = false,
    matchesError: (error: HttpError) => boolean = () => true,
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
      if (raw) return { status: res.status, body: data } as T
      if (!res.ok) {
        const parsed = httpErrorSchema.safeParse(data)
        if (!parsed.success || !matchesError(parsed.data)) throw invalidResponse(method !== 'GET')
        const e = parsed.data
        const requestedWork = /^\/api\/works\/([^/?]+)/.exec(path)?.[1]
        if ('command' in e && e.command.kind === 'execution-result' && requestedWork !== undefined
          && e.command.target.workId !== decodeURIComponent(requestedWork)) throw invalidResponse(method !== 'GET')
        const unknownWrite = 'command' in e && e.command.writeOutcome === 'unknown'
        throw new CliError(e.message, e.code, unknownWrite ? undefined : res.status, e.retryable, e.attemptId, e.issues,
          'command' in e ? { command: e.command, telemetry: e.telemetry, writeOutcome: e.command.writeOutcome } : undefined)
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
  async function configWrite<T>(run: () => Promise<T>): Promise<T> {
    try { return await run() }
    catch (error) {
      if (error instanceof CliError && (error.status === undefined || error.status >= 500)) {
        throw new CliError(error.message, error.code, undefined, error.retryable, error.attemptId, error.issues, { ...error.details, writeOutcome: 'unknown' })
      }
      throw error
    }
  }

  return {
    markBadExample: async (workId: string, input: BadExampleRequest) => {
      const parsed = badExampleRequestSchema.safeParse(input)
      if (!parsed.success) throw new CliError('Invalid bad-example request', 'invalid-input')
      return validate(badExampleSchema, await configWrite(() => call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/bad-examples`, parsed.data, 30_000)),
        result => matchesBadExample(result, workId, parsed.data), true)
    },
    getBadExample: async (workId: string, id: string) => validate(badExampleSchema, await call<unknown>('GET', `/api/works/${encodeURIComponent(workId)}/bad-examples/${encodeURIComponent(id)}`), result => result.workId === workId && result.id === id),
    listBadExamples: async (workId: string, input: BadExampleQuery = {}) => {
      const parsed = badExampleQuerySchema.safeParse(input)
      if (!parsed.success) throw new CliError('Invalid bad-example query', 'invalid-input')
      const query = parsed.data, params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]): [string, string] => [k, String(v)]))
      return validate(badExamplePageSchema, await call<unknown>('GET', `/api/works/${encodeURIComponent(workId)}/bad-examples${params.size ? `?${params}` : ''}`),
        result => result.workId === workId && result.chapter === query.chapter && result.after === query.after)
    },
    getAuthorConfig: async (workId: string) => validate(authorConfigViewSchema, await call<unknown>('GET', `/api/works/${encodeURIComponent(workId)}/agent-config`), view => view.workId === workId),
    saveAuthorConfig: async (workId: string, input: AuthorConfigSave) => {
      const parsed = authorConfigSaveSchema.safeParse(input)
      if (!parsed.success) throw new CliError('Invalid author configuration request', 'invalid-input')
      const request = parsed.data
      return validate(authorConfigReceiptSchema, await configWrite(() => call<unknown>('PUT', `/api/works/${encodeURIComponent(workId)}/agent-config`, request, 30_000)),
        result => result.workId === workId && result.requestId === request.requestId && result.revision === request.expectedRevision + 1 && JSON.stringify(result.document) === JSON.stringify(request.document), true)
    },
    uploadAgentFile: async (workId: string, input: AgentFileUpload) => {
      const parsed = agentFileUploadSchema.safeParse(input)
      if (!parsed.success) throw new CliError('Invalid agent file request', 'invalid-input')
      const text = managedAgentFileText(input.kind, input.text)
      return validate(agentFileSchema, await configWrite(() => call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/agent-files`, parsed.data, 30_000)),
        result => result.workId === workId && result.id === input.requestId && result.kind === input.kind && result.byteLength === Buffer.byteLength(text)
          && result.sha256 === createHash('sha256').update(text).digest('hex'), true)
    },
    getAgentFile: async (workId: string, fileId: string) => validate(agentFileReadSchema, await call<unknown>('GET', `/api/works/${encodeURIComponent(workId)}/agent-files/${encodeURIComponent(fileId)}`),
      result => result.file.workId === workId && result.file.id === fileId && result.file.byteLength === Buffer.byteLength(result.text) && result.file.sha256 === createHash('sha256').update(result.text).digest('hex')),
    getConfig: async () => validate(appConfigSchema, await call<unknown>('GET', '/api/config')),
    listWorks: async (): Promise<WorkSummary[]> => validate(workListResponseSchema, await call<unknown>('GET', '/api/works')),
    createWork: async (input: WorkCreateRequest): Promise<Work> =>
      validate(workSchema, await call<unknown>('POST', '/api/works', input), result => result.seed === input.seed, true),
    getWork: async (workId: string, reconcile = false): Promise<WorkView> => {
      const data = await call<unknown>('GET', `/api/works/${encodeURIComponent(workId)}`, undefined, reconcile ? 10_000 : DEFAULT_CLI_TIMEOUT_MS)
      return validate(workViewSchema, data, result => result.id === workId)
    },
    advance: async (workId: string) => {
      const data = await call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/advance`, undefined, DEFAULT_ADVANCE_TIMEOUT_MS)
      return validate(advanceOutcomeDtoSchema, data, result => result.state.workId === workId, true)
    },
    startChapter: async (workId: string, request: StartChapterRequest) => {
      const data = await call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/chapters/start`, request, 920_000, false,
        error => matchesStartChapterResponse(error, workId, request.chapter))
      return validate(advanceOutcomeDtoSchema, data, result => matchesStartChapterResponse(result, workId, request.chapter), true)
    },
    select: async (workId: string, directionId: string, expectedHeadVersion: number) =>
      validate(artifactSchema, await call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/artifacts/creative/select`, {
        directionId, expectedHeadVersion,
      } satisfies SelectCreativeRequest), result => result.workId === workId && result.kind === 'creative' && result.chapter === undefined && result.humanStatus === 'approved', true),
    saveOutline: async (workId: string, content: OutlineDraft, expectedHeadVersion: number) =>
      validate(artifactSchema, await call<unknown>('PUT', `/api/works/${encodeURIComponent(workId)}/artifacts/outline`, {
        content, expectedHeadVersion,
      } satisfies OutlineDraftRequest), result => result.workId === workId && result.kind === 'outline' && result.chapter === undefined && result.humanStatus === 'pending', true),
    approve: async (workId: string, kind: ArtifactKind) =>
      validate(pipelineStateSchema, await call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/approve`, { kind } satisfies ApproveRequest), result => result.workId === workId, true),
    approveSetting: async (workId: string, request: SettingApproveRequest) => {
      const data = await call<unknown>('POST', `/api/works/${encodeURIComponent(workId)}/artifacts/setting/approve`, request)
      return validate(settingApproveResponseSchema, data, result => result.workId === workId, true)
    },
    // LLM 遥测回看(#14)
    getTelemetry: async (workId: string, query: DiagnosticQuery = {}) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(diagnosticQuerySchema.parse(query))) {
        if (value !== undefined) params.set(key, value)
      }
      const result = validate(diagnosticResponseSchema, await call<unknown>('GET', `/api/works/${encodeURIComponent(workId)}/telemetry${params.size ? `?${params}` : ''}`))
      if (result.workId !== workId) throw new CliError('Diagnostic response belongs to a different work', 'invalid-response')
      return result
    },
    beatCommand: (workId: string, submission: BeatSubmission) => call<{ status: number; body: unknown }>('POST',
      `/api/works/${encodeURIComponent(workId)}/artifacts/beat/${submission.operation === 'approve-beat' ? 'approve' : 'regenerate'}`,
      submission.request, submission.operation === 'approve-beat' ? 30_000 : 920_000, true),
    proseCommand: (workId: string, submission: ProseSubmission) => call<{ status: number; body: unknown }>('POST',
      `/api/works/${encodeURIComponent(workId)}/artifacts/prose/${submission.operation === 'approve-prose' ? 'approve' : submission.operation === 'save-prose' ? 'save' : 'regenerate'}`,
      submission.request, submission.operation === 'regenerate-prose' ? 920_000 : 30_000, true),
  }
}
