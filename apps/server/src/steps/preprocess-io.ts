import { z } from 'zod'
import {
  interviewAnswerSchema,
  interviewQuestionsSchema,
  preprocessContentSchema,
} from '@agent4novel/contracts'

// preprocess 步骤的输入/输出契约（RealStep 与 FakeStep 同源）。
// phase 缺省 = 'normalize'：pipeline 只在 interview 流程显式传，普通 advance 不传。
export const preprocessStepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  phase: z.enum(['questions', 'normalize']).default('normalize'),
  answers: z.array(interviewAnswerSchema).optional(),
})

export const preprocessStepOutputSchema = z.object({
  content: z.union([interviewQuestionsSchema, preprocessContentSchema]),
})

export type PreprocessStepInput = z.input<typeof preprocessStepInputSchema>
export type PreprocessStepOutput = z.infer<typeof preprocessStepOutputSchema>
