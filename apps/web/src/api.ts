import type {
  Artifact,
  CreativeContent,
  Work,
  WorkSummary,
  WorkView,
} from '@agent4novel/contracts'

// advance 的可穷举结果(#3c,与 server pipeline.ts 同形)
export type AdvanceOutcomeDto =
  | { kind: 'advanced'; stepId: string }
  | { kind: 'awaiting-approval' }
  | { kind: 'complete' }
  | { kind: 'failed'; stepId: string; code: string; retryable: boolean; attemptId?: string }

export type AppConfig = { demo: boolean }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    // 统一错误形 { code, retryable, attemptId, message };读不到就退化为状态码
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null
    throw new Error(body?.message ?? `${init?.method ?? 'GET'} ${url} failed: ${res.status}`)
  }
  return res.json()
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/config')
}

export function listWorks(): Promise<WorkSummary[]> {
  return request<WorkSummary[]>('/api/works')
}

export function getWork(id: string): Promise<WorkView> {
  return request<WorkView>(`/api/works/${id}`)
}

export function createWork(input: { seed: string; title?: string }): Promise<Work> {
  return post<Work>('/api/works', input)
}

// saveCreativeDraft:保存全部方向,永远 pending;expectedHeadVersion 乐观锁(409 时 web 保留 dirty edits)
export function saveCreativeDraft(
  workId: string,
  content: CreativeContent,
  expectedHeadVersion: number,
): Promise<Artifact> {
  return request<Artifact>(`/api/works/${workId}/artifacts/creative`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedHeadVersion }),
  })
}

// selectCreativeDirection:显式选定单方向 → approved
export function selectCreativeDirection(
  workId: string,
  directionId: string,
  expectedHeadVersion: number,
): Promise<Artifact> {
  return post<Artifact>(`/api/works/${workId}/artifacts/creative/select`, {
    directionId,
    expectedHeadVersion,
  })
}

export function advance(workId: string): Promise<AdvanceOutcomeDto> {
  return post<AdvanceOutcomeDto>(`/api/works/${workId}/advance`)
}
