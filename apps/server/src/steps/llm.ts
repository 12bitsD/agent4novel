import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createProviderRegistry } from 'ai'
import type { LanguageModel } from 'ai'
import { KnownError } from '../errors.js'

export const DEFAULT_DEEPSEEK_MODEL_ID = 'deepseek:deepseek-chat' as const
export const DEFAULT_LONGCAT_MODEL_ID = 'longcat:LongCat-2.0' as const
export const DEFAULT_LONGCAT_BASE_URL = 'https://api.longcat.chat/openai/v1'

export type SupportedModelId = `deepseek:${string}` | typeof DEFAULT_LONGCAT_MODEL_ID

export class ModelConfigError extends Error {
  readonly code = 'llm-config-invalid'
}

export type ModelRuntime = {
  readonly mode: 'demo' | 'live'
  readonly defaultModelId: SupportedModelId
  readonly requestTimeoutMs: number
  languageModel(modelOverride?: string): LanguageModel
}

const UNCONFIGURED_KEY = 'a4n-unconfigured-provider'

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const text = env[name]?.trim()
  return text || undefined
}

function parseModelId(raw: string): SupportedModelId {
  if (/^deepseek:[^:]+$/.test(raw)) return raw as `deepseek:${string}`
  if (raw === DEFAULT_LONGCAT_MODEL_ID) return raw
  throw new ModelConfigError(
    `unsupported model id "${raw}"; expected deepseek:<model> or ${DEFAULT_LONGCAT_MODEL_ID}`,
  )
}

function baseUrl(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = value(env, name) ?? fallback
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ModelConfigError(`${name} must be an absolute http(s) URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ModelConfigError(`${name} must use http or https`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ModelConfigError(`${name} must not contain credentials, query parameters, or a hash`)
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  if (url.protocol === 'http:' && !loopback) {
    throw new ModelConfigError(`${name} must use https unless it targets a loopback host`)
  }
  return url.toString().replace(/\/+$/, '')
}

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = value(env, 'A4N_LLM_TIMEOUT_MS')
  if (!raw) return 120_000
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 900_000) {
    throw new ModelConfigError('A4N_LLM_TIMEOUT_MS must be an integer between 1000 and 900000')
  }
  return parsed
}

export function createModelRuntime(
  env: NodeJS.ProcessEnv,
  deps: { fetch?: typeof globalThis.fetch } = {},
): ModelRuntime {
  const deepseekKey = value(env, 'DEEPSEEK_API_KEY')
  const longcatKey = value(env, 'LONGCAT_API_KEY')
  const explicitModel = value(env, 'A4N_MODEL')

  const defaultModelId = explicitModel
    ? parseModelId(explicitModel)
    : deepseekKey
      ? DEFAULT_DEEPSEEK_MODEL_ID
      : longcatKey
        ? DEFAULT_LONGCAT_MODEL_ID
        : DEFAULT_DEEPSEEK_MODEL_ID

  const configured = (modelId: SupportedModelId): boolean =>
    modelId.startsWith('deepseek:') ? Boolean(deepseekKey) : Boolean(longcatKey)

  if (explicitModel && !configured(defaultModelId)) {
    const provider = defaultModelId.split(':', 1)[0]
    throw new ModelConfigError(`A4N_MODEL selects provider "${provider}" but its API key is missing`)
  }

  const registry = createProviderRegistry({
    deepseek: createDeepSeek({
      apiKey: deepseekKey ?? UNCONFIGURED_KEY,
      baseURL: baseUrl(env, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    }),
    longcat: createOpenAICompatible({
      name: 'longcat',
      apiKey: longcatKey ?? UNCONFIGURED_KEY,
      baseURL: baseUrl(env, 'LONGCAT_BASE_URL', DEFAULT_LONGCAT_BASE_URL),
      // LongCat 文档未声明 json_schema；AI SDK 会退回较宽松的 json_object。
      supportsStructuredOutputs: false,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    }),
  })

  return {
    mode: configured(defaultModelId) ? 'live' : 'demo',
    defaultModelId,
    requestTimeoutMs: timeoutMs(env),
    languageModel(modelOverride?: string) {
      let modelId: SupportedModelId
      try {
        modelId = modelOverride === undefined ? defaultModelId : parseModelId(modelOverride)
      } catch (err) {
        throw new KnownError(
          'llm-unavailable',
          err instanceof Error ? err.message : 'invalid model configuration',
          { retryable: false },
        )
      }
      if (!configured(modelId)) {
        const provider = modelId.split(':', 1)[0]
        throw new KnownError('llm-unavailable', `LLM provider "${provider}" is not configured`, {
          retryable: false,
        })
      }
      return registry.languageModel(modelId)
    },
  }
}

// server 入口会在动态 import 本模块前载入 .env.local；测试可直接调用 factory 传合成 env。
export const modelRuntime = createModelRuntime(process.env)
