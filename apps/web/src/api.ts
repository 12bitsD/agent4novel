import type {
  Artifact,
  ArtifactKind,
  InterviewAnswer,
  PreprocessContent,
  Work,
  WorkDetail,
  WorkSummary,
} from '@agent4novel/contracts'

// server pipeline 的 wire 形状（PipelineState 是 server 内部类型，这里只声明前端需要的最小面）
export type PipelineStateDto = {
  workId: string
  stage: 'ready' | 'blocked' | 'awaiting-approval' | 'awaiting-interview' | 'complete'
  nextStepId: string | null
  pendingGate?: { kind: ArtifactKind; chapter?: number }
  pendingInterview?: { questions: string[] }
}

export type AppConfig = { demo: boolean; interview: boolean }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status}`)
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

export function getWork(id: string): Promise<WorkDetail> {
  return request<WorkDetail>(`/api/works/${id}`)
}

export function createWork(input: { seed: string; title?: string }): Promise<Work> {
  return post<Work>('/api/works', input)
}

export function savePreprocess(workId: string, content: PreprocessContent): Promise<Artifact> {
  return request<Artifact>(`/api/works/${workId}/artifacts/preprocess`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

export function advance(workId: string): Promise<PipelineStateDto> {
  return post<PipelineStateDto>(`/api/works/${workId}/advance`)
}

export function answerInterview(
  workId: string,
  answers: InterviewAnswer[],
): Promise<PipelineStateDto> {
  return post<PipelineStateDto>(`/api/works/${workId}/answer-interview`, { answers })
}

export function approve(workId: string, kind: ArtifactKind): Promise<PipelineStateDto> {
  return post<PipelineStateDto>(`/api/works/${workId}/approve`, { kind })
}
