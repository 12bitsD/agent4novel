import { z } from 'zod'
import { beatContentSchema, settingContentSchema, proseContentSchema, proseEditDraftSchema, proseLimits } from '@agent4novel/contracts'

export const proseStepInputSchema = z.object({
  workId: z.string(), seed: z.string(), chapter: z.literal(1),
  upstream: z.object({ beat: beatContentSchema, setting: settingContentSchema }).strict(),
  regeneration: z.object({ content: proseEditDraftSchema, instructions: z.string().max(proseLimits.instructions) }).strict().optional(),
}).strict()
export const proseStepOutputSchema = z.object({ content: proseContentSchema }).strict()
