// LLM 遥测(#14):一次 callLlm 调用的观测记录,供 advance 响应内联与查询端点共用
export type LlmTelemetry = {
  stepId: string
  attemptId: string
  model: string
  ok: boolean
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  finishReason?: string
  /** 失败时的错误名(如 AI_NoObjectGeneratedError) */
  error?: string
  promptChars: number
  promptHash: string
  /** system prompt(SKILL.md)内容 hash:prompt 改了版本可追 */
  systemHash: string
}
