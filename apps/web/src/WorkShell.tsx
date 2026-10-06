import type { ReactNode } from 'react'

// The work owns its frame; chapter sessions only own their commands and editing state.
export default function WorkShell({ workId, children }: { workId: string; children: ReactNode }) {
  return <main className="workbench" aria-label="作品编稿台" data-work-id={workId}>{children}</main>
}
