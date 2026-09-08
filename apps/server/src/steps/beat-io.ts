import { z } from 'zod'
import { beatContentSchema, beatEditDraftSchema, beatLimits, outlineContentSchema, settingContentSchema } from '@agent4novel/contracts'

export const beatStepInputSchema = z.object({
  workId: z.string(), seed: z.string(), chapter: z.literal(1),
  upstream: z.object({ outline: outlineContentSchema, setting: settingContentSchema }),
  regeneration: z.object({ content: beatEditDraftSchema, instructions: z.string().max(beatLimits.instructions) }).optional(),
})
export const beatStepOutputSchema = z.object({ content: beatContentSchema })
