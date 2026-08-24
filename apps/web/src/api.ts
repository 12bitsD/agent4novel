import type { Artifact, PreprocessContent, Work, WorkDetail, WorkSummary } from '@agent4novel/contracts'

export async function listWorks(): Promise<WorkSummary[]> {
  const res = await fetch('/api/works')
  if (!res.ok) throw new Error(`listWorks failed: ${res.status}`)
  return res.json()
}

export async function getWork(id: string): Promise<WorkDetail> {
  const res = await fetch(`/api/works/${id}`)
  if (!res.ok) throw new Error(`getWork failed: ${res.status}`)
  return res.json()
}

export async function createWork(input: { seed: string; title?: string }): Promise<Work> {
  const res = await fetch('/api/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createWork failed: ${res.status}`)
  return res.json()
}

export async function savePreprocess(workId: string, content: PreprocessContent): Promise<Artifact> {
  const res = await fetch(`/api/works/${workId}/artifacts/preprocess`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`savePreprocess failed: ${res.status}`)
  return res.json()
}
