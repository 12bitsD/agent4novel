import { z } from 'zod'

// 预处理产物最终形态（#3b 定案，provisional 转正）：识别输入所处阶段 + 四类要点多实例并存。
// 领域词见 CONTEXT.md「预处理」；形状单源同步 docs/schema.md。
export const inputStages = ['脑洞', '设定', '主线', '模板'] as const
export type InputStage = (typeof inputStages)[number]

export const preprocessContentSchema = z.object({
  inputStage: z.enum(inputStages),
  hooks: z.array(z.string()),
  synopsis: z.array(z.string()),
  setting: z.array(z.object({ title: z.string(), content: z.string() })),
  outline: z.array(z.object({ title: z.string(), content: z.string() })),
})
export type PreprocessContent = z.infer<typeof preprocessContentSchema>

// interview（反向问答）：questions 阶段输出 / answer-interview 输入，web 问答表单复用。
export const interviewQuestionsSchema = z.object({
  questions: z.array(z.string()),
})
export type InterviewQuestions = z.infer<typeof interviewQuestionsSchema>

export const interviewAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
})
export type InterviewAnswer = z.infer<typeof interviewAnswerSchema>
