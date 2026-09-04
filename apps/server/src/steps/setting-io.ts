import { z } from 'zod'
import { captionContentSchema, creativeContentSchema, outlineContentSchema, settingContentSchema } from '@agent4novel/contracts'

export const settingStepInputSchema = z.object({
  workId: z.string(), seed: z.string(),
  upstream: z.object({
    caption: captionContentSchema,
    creative: creativeContentSchema.refine((content) => content.directions.length === 1, 'creative must contain one selected direction'),
    outline: outlineContentSchema,
  }),
})
export const settingStepOutputSchema = z.object({ content: settingContentSchema })
