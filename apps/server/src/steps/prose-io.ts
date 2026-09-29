import { z } from 'zod'
import { beatContentSchema, settingContentSchema, proseContentSchema, proseEditDraftSchema, proseLimits } from '@agent4novel/contracts'
import { chapterNumberSchema, previousChapterSchema, validatePreviousChapter } from './chapter-context.js'

export const proseStepInputSchema = z.object({
  workId: z.string(), seed: z.string(), chapter: chapterNumberSchema,
  upstream: z.object({ beat: beatContentSchema, setting: settingContentSchema, previousChapter: previousChapterSchema.optional() }).strict(),
  regeneration: z.object({ content: proseEditDraftSchema, instructions: z.string().max(proseLimits.instructions) }).strict().optional(),
}).strict().superRefine(validatePreviousChapter)
export const proseStepOutputSchema = z.object({ content: proseContentSchema }).strict()
