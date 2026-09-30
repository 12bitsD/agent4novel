import type {
  Artifact, ArtifactKind, AdvanceOutcomeDto, CreativeContent, OutlineDraft,
  Work, WorkSummary, WorkView, StartChapterRequest, WorkCreateRequest,
  CreativeDraftRequest, SelectCreativeRequest, OutlineDraftRequest, ApproveRequest, HttpError,
} from '@agent4novel/contracts'
import {
  advanceOutcomeDtoSchema, workViewSchema, workSchema, workListResponseSchema,
  artifactSchema, pipelineStateSchema, appConfigSchema, httpErrorSchema, matchesStartChapterResponse,
} from '@agent4novel/contracts'
import { withDeadline } from './request-deadline.js'
import { authorConfigViewSchema, authorConfigReceiptSchema, authorConfigSaveSchema, agentFileSchema, agentFileReadSchema, agentFileUploadSchema,
  managedAgentFileText, type AuthorConfigSave, type AgentFileUpload } from '@agent4novel/contracts'
export type { AdvanceOutcomeDto, StartChapterRequest, AppConfig } from '@agent4novel/contracts'

function invalidResponse(write: boolean): Error {
  return Object.assign(new Error('服务器响应无效，请核对作品后再重试'), {
    code: 'invalid-response', ...(write ? { writeOutcome: 'unknown' } : {}),
  })
}

function validate<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } },
  data: unknown, matches: (result: T) => boolean = () => true, write = false): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success || !matches(parsed.data)) throw invalidResponse(write)
  return parsed.data
}

async function request(url: string, init?: RequestInit, matchesError: (error: HttpError) => boolean = () => true): Promise<unknown> {
  const write = init?.method !== undefined && init.method !== 'GET'
  const res = await fetch(url, init)
  let body: unknown
  try { body = await res.json() } catch { throw invalidResponse(write) }
  if (!res.ok) {
    const parsed = httpErrorSchema.safeParse(body)
    if (!parsed.success || !matchesError(parsed.data)) throw invalidResponse(write)
    const error = parsed.data
    const requestedWork = /^\/api\/works\/([^/?]+)/.exec(url)?.[1]
    if ('command' in error && error.command.kind === 'execution-result' && requestedWork !== undefined
      && error.command.target.workId !== decodeURIComponent(requestedWork)) throw invalidResponse(write)
    // A valid command envelope can still report an unknown write, even with a 4xx status.
    const unknownWrite = 'command' in error && error.command.writeOutcome === 'unknown'
    throw Object.assign(new Error(error.message), error,
      unknownWrite ? { writeOutcome: 'unknown' } : { status: res.status })
  }
  return body
}

function post(url: string, body?: unknown): Promise<unknown> {
  return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
}

export async function getConfig() {
  return validate(appConfigSchema, await request('/api/config'))
}
async function configRequest(url: string, method = 'GET', body?: unknown): Promise<unknown> {
  try {
    return await withDeadline(method === 'GET' ? 10_000 : 30_000, signal => request(url, {
      method, signal, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }))
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (method !== 'GET' && (status === undefined || status >= 500)) throw Object.assign(new Error('配置写入结果尚未确认，请保留原请求并核对'), { writeOutcome: 'unknown' })
    throw error
  }
}
const configBase = (workId: string) => `/api/works/${encodeURIComponent(workId)}`
export async function getAuthorConfig(workId: string) {
  return validate(authorConfigViewSchema, await configRequest(`${configBase(workId)}/agent-config`), result => result.workId === workId)
}
export async function saveAuthorConfig(workId: string, input: AuthorConfigSave) {
  const request = authorConfigSaveSchema.parse(input)
  return validate(authorConfigReceiptSchema, await configRequest(`${configBase(workId)}/agent-config`, 'PUT', request), result => result.workId === workId
    && result.requestId === request.requestId && result.revision === request.expectedRevision + 1 && JSON.stringify(result.document) === JSON.stringify(request.document), true)
}
export async function uploadAgentFile(workId: string, input: AgentFileUpload) {
  const request = agentFileUploadSchema.parse(input)
  const bytes = new TextEncoder().encode(managedAgentFileText(input.kind, input.text))
  const hash = await fileHash(bytes)
  return validate(agentFileSchema, await configRequest(`${configBase(workId)}/agent-files`, 'POST', request), result => result.workId === workId
    && result.id === request.requestId && result.kind === request.kind && result.sha256 === hash && result.byteLength === bytes.length, true)
}
async function fileHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function getAgentFile(workId: string, id: string) {
  const result = validate(agentFileReadSchema, await configRequest(`${configBase(workId)}/agent-files/${encodeURIComponent(id)}`), result => result.file.workId === workId && result.file.id === id)
  const bytes = new TextEncoder().encode(result.text)
  if (result.file.byteLength !== bytes.length || result.file.sha256 !== await fileHash(bytes)) throw invalidResponse(false)
  return result
}
export async function listWorks(): Promise<WorkSummary[]> {
  return validate(workListResponseSchema, await request('/api/works'))
}
export async function getWork(id: string): Promise<WorkView> {
  return withDeadline(10_000, async signal => validate(workViewSchema,
    await request(`/api/works/${encodeURIComponent(id)}`, { signal }), result => result.id === id))
}
export async function createWork(input: WorkCreateRequest): Promise<Work> {
  return validate(workSchema, await post('/api/works', input), result => result.seed === input.seed, true)
}

async function writeArtifact(workId: string, kind: 'creative' | 'outline', status: 'pending' | 'approved', path: string,
  method: 'PUT' | 'POST', body: unknown): Promise<Artifact> {
  return validate(artifactSchema, await request(`/api/works/${encodeURIComponent(workId)}/artifacts/${kind}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), result => result.workId === workId && result.kind === kind && result.chapter === undefined && result.humanStatus === status, true)
}

// 保存全部方向，保持 pending；409 时调用者保留编辑内容。
export function saveCreativeDraft(workId: string, content: CreativeContent, expectedHeadVersion: number): Promise<Artifact> {
  return writeArtifact(workId, 'creative', 'pending', '', 'PUT', { content, expectedHeadVersion } satisfies CreativeDraftRequest)
}
export function selectCreativeDirection(workId: string, directionId: string, expectedHeadVersion: number): Promise<Artifact> {
  return writeArtifact(workId, 'creative', 'approved', '/select', 'POST', { directionId, expectedHeadVersion } satisfies SelectCreativeRequest)
}
export async function advance(workId: string): Promise<AdvanceOutcomeDto> {
  return withDeadline(1_820_000, async signal => validate(advanceOutcomeDtoSchema,
    await request(`/api/works/${encodeURIComponent(workId)}/advance`, { method: 'POST', signal }),
    result => result.state.workId === workId, true))
}
export async function startChapter(workId: string, input: StartChapterRequest): Promise<AdvanceOutcomeDto> {
  return withDeadline(1_820_000, async signal => validate(advanceOutcomeDtoSchema,
    await request(`/api/works/${encodeURIComponent(workId)}/chapters/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal,
    }, error => matchesStartChapterResponse(error, workId, input.chapter)),
    result => matchesStartChapterResponse(result, workId, input.chapter), true))
}
export function saveOutlineDraft(workId: string, content: OutlineDraft, expectedHeadVersion: number): Promise<Artifact> {
  return writeArtifact(workId, 'outline', 'pending', '', 'PUT', { content, expectedHeadVersion } satisfies OutlineDraftRequest)
}
export async function approveArtifact(workId: string, kind: ArtifactKind) {
  return validate(pipelineStateSchema, await post(`/api/works/${encodeURIComponent(workId)}/approve`, { kind } satisfies ApproveRequest),
    result => result.workId === workId, true)
}
