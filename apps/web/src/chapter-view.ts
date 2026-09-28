import type { WorkView } from '@agent4novel/contracts'

export function chapterLabel(chapter: number): string {
  return chapter === 1 ? '第一章' : `第 ${chapter} 章`
}

// Chapter permissions come from the same server snapshot as the chapter heads.
// An empty directory is used only before the first chapter and by legacy snapshots.
export function chapterActions(work: WorkView | null | undefined, chapter: number): string[] {
  return work?.chapters.find(item => item.chapter === chapter)?.allowedActions
    ?? (work && !work.chapters.length && chapter === work.currentChapter ? work.allowedActions : [])
}
