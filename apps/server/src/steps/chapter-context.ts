import { z } from 'zod'
import { beatContentSchema, proseContentSchema } from '@agent4novel/contracts'

export const chapterNumberSchema = z.number().int().positive().safe()
export const previousChapterSchema = z.object({
  chapter: chapterNumberSchema, beat: beatContentSchema, prose: proseContentSchema,
}).strict()

// Both production and isolated Steps require precisely the preceding approved chapter.
export function validatePreviousChapter(
  input: { chapter: number; upstream: { previousChapter?: z.infer<typeof previousChapterSchema> } },
  ctx: z.RefinementCtx,
): void {
  const previous = input.upstream.previousChapter
  if (input.chapter === 1 ? previous !== undefined : previous?.chapter !== input.chapter - 1) {
    ctx.addIssue({ code: 'custom', path: ['upstream', 'previousChapter'], message: 'previousChapter must match chapter - 1 and must be absent for chapter 1' })
  }
}
