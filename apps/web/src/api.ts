import type { WorkDetail, WorkSummary } from '@agent4novel/contracts'

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
