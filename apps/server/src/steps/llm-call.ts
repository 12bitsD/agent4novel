import { generateObject } from 'ai'
import type { AgentConfig } from '@agent4novel/contracts'
import type { z } from 'zod'
import { KnownError } from '../errors.js'
import { defaultModelId, registry } from './llm.js'

// 超长素材统一截断点(#3c 决策 17):caption/creative 共用,按 deepseek-chat context window 定的保守 budget
export const SEED_CHAR_BUDGET = 100_000
export function truncateSeed(seed: string): string {
  return seed.length > SEED_CHAR_BUDGET ? seed.slice(0, SEED_CHAR_BUDGET) : seed
}

// LLM 调用小帮手(#3c 决策 15/16):generateObject + zod + token 上限 + 超时;类型化错误。
// 日志只记 attemptId/model/latency/token/finishReason,不落素材/prompt 全文。
export async function callLlm<T>(args: {
  schema: z.ZodType<T>
  system: string
  prompt: string
  config: AgentConfig
  stepId: string
  attemptId: string
}): Promise<T> {
  const model = (args.config.model ?? defaultModelId) as `deepseek:${string}`
  const started = Date.now()
  try {
    const { object, usage, finishReason } = await generateObject({
      model: registry.languageModel(model),
      schema: args.schema,
      system: args.system,
      prompt: args.prompt,
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(120_000),
    })
    console.log(
      JSON.stringify({
        event: 'llm.call',
        stepId: args.stepId,
        attemptId: args.attemptId,
        model,
        latencyMs: Date.now() - started,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        finishReason,
        promptChars: args.prompt.length,
      }),
    )
    return object
  } catch (err) {
    console.log(
      JSON.stringify({
        event: 'llm.error',
        stepId: args.stepId,
        attemptId: args.attemptId,
        model,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.name : String(err),
      }),
    )
    if (err instanceof KnownError) throw err
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new KnownError('llm-timeout', 'llm request timed out', {
        retryable: true,
        attemptId: args.attemptId,
      })
    }
    // generateObject 的 schema 校验失败(AI SDK 抛 NoObjectGeneratedError)→ 模型输出非法
    if (name === 'NoObjectGeneratedError' || name === 'AI_TypeValidationError') {
      throw new KnownError('llm-invalid-output', 'llm output failed schema validation', {
        retryable: true,
        attemptId: args.attemptId,
      })
    }
    throw new KnownError('llm-unavailable', err instanceof Error ? err.message : String(err), {
      retryable: true,
      attemptId: args.attemptId,
    })
  }
}
