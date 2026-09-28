import type { ProseSubmission } from '@agent4novel/contracts'
import { withDeadline } from './request-deadline.js'
export async function postProseCommand(workId: string, submission: ProseSubmission): Promise<{ status: number; body: unknown }> {
  const operation = submission.operation === 'approve-prose' ? 'approve' : submission.operation === 'save-prose' ? 'save' : 'regenerate'
  return withDeadline(operation === 'regenerate' ? 920_000 : 30_000, async signal => {
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}/artifacts/prose/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission.request), signal,
    })
    return { status: response.status, body: await response.json() }
  })
}
