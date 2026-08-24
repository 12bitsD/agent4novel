import type { Artifact, PreprocessContent, Work, WorkDetail, WorkSummary } from '@agent4novel/contracts'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status}`)
  return res.json()
}

export function listWorks(): Promise<WorkSummary[]> {
  return request<WorkSummary[]>('/api/works')
}

export function getWork(id: string): Promise<WorkDetail> {
  return request<WorkDetail>(`/api/works/${id}`)
}

export function createWork(input: { seed: string; title?: string }): Promise<Work> {
  return request<Work>('/api/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function savePreprocess(workId: string, content: PreprocessContent): Promise<Artifact> {
  return request<Artifact>(`/api/works/${workId}/artifacts/preprocess`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}
