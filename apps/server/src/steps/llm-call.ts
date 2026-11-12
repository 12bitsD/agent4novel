import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { seedCharBudget, authorConfigLimits, agentConfigSchema } from '@agent4novel/contracts'
import type { AgentConfig, GenerationParameters } from '@agent4novel/contracts'
import type { z } from 'zod'
import { KnownError } from '../errors.js'
import { modelRuntime } from './llm.js'
import { runNextloop } from './nextloop-client.js'
import { NextloopError } from './nextloop-error.js'
import { recordTelemetry, currentRequest } from './telemetry.js'
import { safeLog } from '../safe-log.js'
import { currentStepRecorder, StepRecordError } from './step-record.js'

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

export function systemFor(stepId: string, config: AgentConfig, override?: string): string {
  const base = override ?? loadSkill(stepId)
  const system = config.systemPrompt ? `${base}\n\nAuthor writing guidance (output contracts still apply):\n${config.systemPrompt}` : base
  // Managed author files have their own limit. The isolated experiment's
  // explicit SP override retains its existing assembled-input budget.
  if (config.configRevision !== undefined && system.length > authorConfigLimits.systemChars) throw new KnownError('config-invalid', 'assembled author system context exceeds budget')
  return system
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
  if (error instanceof NextloopError) {
    if (error.code === 'llm-timeout') return 'timeout'
    if (error.finishReason === 'length') return 'output-truncated'
    if (error.code === 'llm-invalid-output') return 'output-schema'
    return 'network'
  }
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

// 六节点共用 Nextloop + zod + token 上限 + 超时;类型化错误。
// 日志只记 attemptId/model/latency/token/finishReason/长度+hash,不落素材/prompt 全文。
// 每次调用(成败)都记一条 telemetry 进账本,systemHash 让 prompt 版本可追。
export async function callLlm<T>(args: {
  schema: z.ZodType<T>
  system: string
  prompt: string
  config: AgentConfig
  workId: string
  stepId: string
  chapter?: number
  attemptId: string
  /** 默认 8000;长产物步骤(如 outline)实测会撞顶截断(#14 排查),可上调 */
  maxOutputTokens?: number
  /** 仅整份设定明确关闭 Provider 重试；其他步骤保留现有默认行为。 */
  maxRetries?: number
  /** Node assembly settings already resolved by the production step. */
  effectiveConfig?: { directionCount?: number }
}): Promise<T> {
  const model = args.config.model ?? modelRuntime.defaultModelId
  const started = Date.now()
  const provenance = agentConfigSchema.pick({ configRevision: true, configFiles: true }).safeParse({ configRevision: args.config.configRevision, configFiles: args.config.configFiles })
  const base = {
    stepId: args.stepId,
    ...(args.chapter !== undefined ? { chapter: args.chapter } : {}),
    attemptId: args.attemptId,
    model: /^(deepseek:[a-zA-Z0-9_.-]{1,96}|kimi:[a-zA-Z0-9_.-]{1,96}|longcat:LongCat-2\.0)$/.test(model) ? model : 'unrecognized-model',
    ...(currentRequest() ? { requestId: currentRequest()!.requestId } : {}),
    promptChars: args.prompt.length,
    promptHash: hash12(args.prompt),
    systemHash: hash12(args.system),
    ...(provenance.success ? provenance.data : {}),
  }
  let generation: GenerationParameters | undefined
  try {
    const languageModel = modelRuntime.languageModel(model)
    const settings = modelRuntime.generationSettings(args.config)
    generation = settings.parameters
    await currentStepRecorder()?.captureInvocation({
      system: args.system,
      prompt: args.prompt,
      model,
      attemptId: args.attemptId,
      effectiveConfig: {
        model,
        directionCount: args.effectiveConfig?.directionCount ?? null,
        thinking: settings.parameters.thinking ?? null,
        temperature: settings.parameters.temperature ?? null,
        topP: settings.parameters.topP ?? null,
      },
      generation: {
        thinking: settings.parameters.thinking ?? null,
        temperature: settings.parameters.temperature ?? null,
        topP: settings.parameters.topP ?? null,
      },
      sdkOptions: {
        temperature: settings.options.temperature ?? null,
        topP: settings.options.topP ?? null,
        providerOptions: settings.options.providerOptions ?? null,
      },
      maxOutputTokens: args.maxOutputTokens ?? 8000,
      maxRetries: args.maxRetries ?? null,
      requestTimeoutMs: modelRuntime.requestTimeoutMs,
    })
    const { object, usage, finishReason } = await runNextloop({
      model: languageModel,
      ...settings.options,
      schema: args.schema,
      system: args.system,
      prompt: args.prompt,
      attemptId: args.attemptId,
      timeoutMs: modelRuntime.requestTimeoutMs,
      maxOutputTokens: args.maxOutputTokens ?? 8000,
      ...(args.maxRetries !== undefined ? { maxRetries: args.maxRetries } : {}),
    })
    if (finishReason === 'length') throw new NextloopError('llm-invalid-output', true, usage, finishReason)
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
    if (err instanceof StepRecordError) throw err
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
    if (err instanceof NextloopError) {
      const message = err.code === 'llm-timeout' ? 'llm request timed out'
        : err.code === 'llm-invalid-output' ? 'llm output failed schema validation' : 'llm request unavailable'
      throw new KnownError(err.code, message, {
        retryable: err.retryable,
        attemptId: args.attemptId,
      })
    }
    // Zod 校验失败统一映射为模型输出非法，不暴露原始响应。
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
