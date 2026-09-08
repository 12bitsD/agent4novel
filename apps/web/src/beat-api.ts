import type { BeatSubmission } from '@agent4novel/contracts'
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
