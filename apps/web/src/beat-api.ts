import type { BeatSubmission, BeatVariantSelectionRequest } from '@agent4novel/contracts'
import { withDeadline } from './request-deadline.js'
export async function postBeatCommand(workId: string, submission: BeatSubmission): Promise<{ status: number; body: unknown }> {
  const operation = submission.operation === 'approve-beat' ? 'approve' : 'regenerate'
  return withDeadline(operation === 'approve' ? 30_000 : 920_000, async signal => {
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}/artifacts/beat/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission.request), signal,
    })
    return { status: response.status, body: await response.json() }
  })
}

export async function postBeatVariantSelection(workId: string, request: BeatVariantSelectionRequest): Promise<{ status: number; body: unknown }> {
  return withDeadline(30_000, async signal => {
    const response = await fetch('/api/works/' + encodeURIComponent(workId) + '/artifacts/beat/select', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal,
    })
    return { status: response.status, body: await response.json() }
  })
}
