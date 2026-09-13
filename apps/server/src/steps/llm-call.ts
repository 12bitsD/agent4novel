import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { generateObject } from 'ai'
import { seedCharBudget } from '@agent4novel/contracts'
import type { AgentConfig, GenerationParameters } from '@agent4novel/contracts'
import type { z } from 'zod'
import { KnownError } from '../errors.js'
import { modelRuntime } from './llm.js'
import { recordTelemetry, currentRequest } from './telemetry.js'
import { safeLog } from '../safe-log.js'

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

const safeFinish = (value: unknown) => typeof value === 'string' && ['stop', 'length', 'content-filter', 'tool-calls', 'error', 'other', 'unknown'].includes(value) ? value : 'unknown'
const safeTokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
function classify(error: unknown): string {
  const e = error as { name?: string; finishReason?: unknown; code?: unknown; data?: { error?: { code?: unknown } } }
  const name = typeof e?.name === 'string' ? e.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  if (e?.code === 'llm-config-invalid' || (error instanceof KnownError && !error.retryable && error.code === 'llm-unavailable')) return 'configuration'
  if (e?.data?.error?.code === 'context_length_exceeded' || e?.data?.error?.code === 'max_context_length') return 'context-limit'
  if (e?.finishReason === 'length') return 'output-truncated'
  if (name.includes('NoObjectGeneratedError') || name === 'AI_TypeValidationError' || name === 'ZodError') return 'output-schema'
  if (name === 'TypeError' || name === 'AI_APICallError' || name === 'AI_RetryError') return 'network'
  return 'unknown'
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
  /** 仅整份设定明确关闭 SDK 重试；其他步骤保留现有 SDK 默认行为。 */
  maxRetries?: number
}): Promise<T> {
  const model = args.config.model ?? modelRuntime.defaultModelId
  const started = Date.now()
  const base = {
    stepId: args.stepId,
    attemptId: args.attemptId,
    model: /^(deepseek:[a-zA-Z0-9_.-]{1,96}|longcat:LongCat-2\.0)$/.test(model) ? model : 'unrecognized-model',
    ...(currentRequest() ? { requestId: currentRequest()!.requestId } : {}),
    promptChars: args.prompt.length,
    promptHash: hash12(args.prompt),
    systemHash: hash12(args.system),
  }
  let generation: GenerationParameters | undefined
  try {
    const languageModel = modelRuntime.languageModel(model)
    const settings = modelRuntime.generationSettings(args.config)
    generation = settings.parameters
    const { object, usage, finishReason } = await generateObject({
      model: languageModel,
      ...settings.options,
      schema: args.schema,
      system: args.system,
      prompt: args.prompt,
      maxOutputTokens: args.maxOutputTokens ?? 8000,
      ...(args.maxRetries !== undefined ? { maxRetries: args.maxRetries } : {}),
      abortSignal: AbortSignal.timeout(modelRuntime.requestTimeoutMs),
    })
    if (finishReason === 'length') throw Object.assign(new Error('output truncated'), { name: 'AI_NoObjectGeneratedError', finishReason, usage })
    const validated = args.schema.parse(object)
    const telemetry = {
      ...base,
      ...(generation ? { generation } : {}),
      ok: true as const,
      latencyMs: Date.now() - started,
      inputTokens: safeTokens(usage?.inputTokens),
      outputTokens: safeTokens(usage?.outputTokens),
      finishReason: safeFinish(finishReason),
    }
    recordTelemetry(args.workId, telemetry)
    safeLog({ event: 'llm.call', ...telemetry })
    return validated
  } catch (err) {
    // Provider text, nested causes, and arbitrary messages are never public diagnostics.
    const diag = err as {
      finishReason?: string
      usage?: { outputTokens?: number }
      text?: string
      cause?: Error
    }
    const telemetry = {
      ...base,
      ...(generation ? { generation } : {}),
      ok: false as const,
      latencyMs: Date.now() - started,
      error: classify(err),
      outputTokens: safeTokens(diag?.usage?.outputTokens),
      finishReason: safeFinish(diag?.finishReason),
    }
    recordTelemetry(args.workId, telemetry)
    safeLog({
        event: 'llm.error',
        ...telemetry,
        textChars: typeof diag?.text === 'string' ? diag.text.length : undefined,
      })
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new KnownError('llm-timeout', 'llm request timed out', {
        retryable: true,
        attemptId: args.attemptId,
      })
    }
    // generateObject 的 schema 校验失败(AI SDK 抛 NoObjectGeneratedError,v7 实际名为 AI_ 前缀)→ 模型输出非法
    if (name.includes('NoObjectGeneratedError') || name === 'AI_TypeValidationError' || name === 'ZodError') {
      throw new KnownError('llm-invalid-output', 'llm output failed schema validation', {
        retryable: true,
        attemptId: args.attemptId,
      })
    }
    throw new KnownError('llm-unavailable', 'llm request unavailable', {
      retryable: err instanceof KnownError ? err.retryable : true,
      attemptId: args.attemptId,
    })
  }
}
