import { z } from 'zod'

// LLM 遥测(#14):一次 callLlm 调用的观测记录，公开运行时边界与类型同源。
export const llmTelemetrySchema = z.object({
  stepId: z.string(), attemptId: z.string(), model: z.string(), ok: z.boolean(),
  latencyMs: z.number().nonnegative(), inputTokens: z.number().optional(), outputTokens: z.number().optional(),
  finishReason: z.string().optional(), error: z.string().optional(),
  promptChars: z.number().nonnegative(), promptHash: z.string(), systemHash: z.string(),
}).strict()
export type LlmTelemetry = z.infer<typeof llmTelemetrySchema>
