import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { generateObject } from 'ai'
import { seedCharBudget } from '@agent4novel/contracts'
import type { AgentConfig } from '@agent4novel/contracts'
import type { z } from 'zod'
import { KnownError } from '../errors.js'
import { defaultModelId, registry } from './llm.js'
import { recordTelemetry } from './telemetry.js'

// 提示词以文件维护(ADR-0002),各 step 一个目录,此处共享 loader,模块级缓存
const skillCache = new Map<string, string>()
export function loadSkill(stepId: string): string {
  let text = skillCache.get(stepId)
  if (!text) {
    text = readFileSync(new URL(`./skills/${stepId}/SKILL.md`, import.meta.url), 'utf8')
    skillCache.set(stepId, text)
  }
  return text
}

// 超长素材统一截断点(#3c 决策 17):caption/creative 共用;budget 单源在 contracts/limits.ts
export function truncateSeed(seed: string): string {
  return seed.length > seedCharBudget ? seed.slice(0, seedCharBudget) : seed
}

function hash12(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

// LLM 调用小帮手(#3c 决策 15/16):generateObject + zod + token 上限 + 超时;类型化错误。
// 日志只记 attemptId/model/latency/token/finishReason/长度+hash,不落素材/prompt 全文。
// #14:每次调用(成败)都记一条 telemetry 进账本,systemHash 让 prompt 版本可追。
export async function callLlm<T>(args: {
  schema: z.ZodType<T>
  system: string
  prompt: string
  config: AgentConfig
  workId: string
  stepId: string
  attemptId: string
  /** 默认 8000;长产物步骤(如 outline)实测会撞顶截断(#14 排查),可上调 */
  maxOutputTokens?: number
}): Promise<T> {
  const model = (args.config.model ?? defaultModelId) as `deepseek:${string}`
  const started = Date.now()
  const base = {
    stepId: args.stepId,
    attemptId: args.attemptId,
    model,
    promptChars: args.prompt.length,
    promptHash: hash12(args.prompt),
    systemHash: hash12(args.system),
  }
  try {
    const { object, usage, finishReason } = await generateObject({
      model: registry.languageModel(model),
      schema: args.schema,
      system: args.system,
      prompt: args.prompt,
      maxOutputTokens: args.maxOutputTokens ?? 8000,
      abortSignal: AbortSignal.timeout(120_000),
    })
    const telemetry = {
      ...base,
      ok: true as const,
      latencyMs: Date.now() - started,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      finishReason,
    }
    recordTelemetry(args.workId, telemetry)
    console.log(JSON.stringify({ event: 'llm.call', ...telemetry }))
    return object
  } catch (err) {
    // 诊断字段(#14 排查):NoObjectGeneratedError 自带 finishReason/usage/text,
    // 只记 text 尾片段(截断假设的证据在结尾),不落全文
    const diag = err as {
      finishReason?: string
      usage?: { outputTokens?: number }
      text?: string
      cause?: Error
    }
    const telemetry = {
      ...base,
      ok: false as const,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.name : String(err),
      outputTokens: diag.usage?.outputTokens,
      finishReason: diag.finishReason,
    }
    recordTelemetry(args.workId, telemetry)
    console.log(
      JSON.stringify({
        event: 'llm.error',
        ...telemetry,
        textChars: diag.text?.length,
        textTail: diag.text?.slice(-200),
        // cause 链是 finishReason=stop 却校验失败时的关键证据(zod issues / JSON parse 位置)
        causeName: diag.cause?.name,
        causeMessage: diag.cause?.message.slice(0, 500),
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
    // generateObject 的 schema 校验失败(AI SDK 抛 NoObjectGeneratedError,v7 实际名为 AI_ 前缀)→ 模型输出非法
    if (name.includes('NoObjectGeneratedError') || name === 'AI_TypeValidationError') {
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
