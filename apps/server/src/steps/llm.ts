import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createProviderRegistry } from "ai";
import type { LanguageModel } from "ai";
import {
  agentConfigSchema,
  generationParametersSchema,
  parseModelId as parseSupportedModelId,
  providerForModel,
} from "@agent4novel/contracts";
import type {
  AgentConfig,
  GenerationParameters,
  SupportedModelId,
} from "@agent4novel/contracts";
import { KnownError } from "../errors.js";

export const DEFAULT_DEEPSEEK_MODEL_ID = "deepseek:deepseek-chat" as const;
export const DEFAULT_LONGCAT_MODEL_ID = "longcat:LongCat-2.0" as const;
export const DEFAULT_KIMI_MODEL_ID = "kimi:kimi-k2.8-highspeed" as const;
export const DEFAULT_LONGCAT_BASE_URL = "https://api.longcat.chat/openai/v1";
export const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.cn/v1";

export type { SupportedModelId } from "@agent4novel/contracts";

export class ModelConfigError extends Error {
  readonly code = "llm-config-invalid";
}

export type GenerationSettings = {
  parameters: GenerationParameters;
  options: Pick<GenerationParameters, "temperature" | "topP"> & {
    providerOptions?: {
      longcat: { thinking: { type: "enabled" | "disabled" } };
    };
  };
};

// Application trial profile for story creation, not vendor defaults or a
// measured optimum.
const LONGCAT_STORY_PARAMETERS = {
  thinking: "disabled",
  temperature: 0.9,
  topP: 0.95,
} as const;

export type ModelRuntime = {
  readonly mode: "demo" | "live";
  readonly defaultModelId: SupportedModelId;
  readonly requestTimeoutMs: number;
  languageModel(modelOverride?: string): LanguageModel;
  generationSettings(config?: AgentConfig): GenerationSettings;
};

type ProviderKeys = {
  deepseek?: string;
  longcat?: string;
  kimi?: string;
};

type RuntimeContext = {
  defaultModelId: SupportedModelId;
  keys: ProviderKeys;
  registry: ReturnType<typeof createProviderRegistry>;
};

const UNCONFIGURED_KEY = "a4n-unconfigured-provider";

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  // trim：处理当前步骤。
  const text = env[name]?.trim();
  return text || undefined;
}

function parseModelId(raw: string): SupportedModelId {
  // parseSupportedModelId：解析当前输入。
  const modelId = parseSupportedModelId(raw);
  if (modelId) {
    return modelId;
  }
  throw new ModelConfigError(
    `unsupported model id "${raw}"; expected deepseek:<model>, kimi:<model>, or ${DEFAULT_LONGCAT_MODEL_ID}`,
  );
}

function configured(modelId: SupportedModelId, keys: ProviderKeys): boolean {
  // providerForModel：处理当前步骤。
  switch (providerForModel(modelId)) {
    case "deepseek":
      // Boolean：转换布尔值。
      return Boolean(keys.deepseek);
    case "kimi":
      // Boolean：转换布尔值。
      return Boolean(keys.kimi);
    case "longcat":
      // Boolean：转换布尔值。
      return Boolean(keys.longcat);
    default:
      return false;
  }
}

function parseBaseUrl(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelConfigError(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ModelConfigError(`${name} must use http or https`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ModelConfigError(
      `${name} must not contain credentials, query parameters, or a hash`,
    );
  }
  return url;
}

function loopbackUrl(url: URL): boolean {
  // test：处理当前步骤。
  return (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  );
}

function baseUrl(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  // parseBaseUrl：解析当前输入。
  // value：处理当前步骤。
  const url = parseBaseUrl(value(env, name) ?? fallback, name);
  // loopbackUrl：处理当前步骤。
  if (url.protocol === "http:" && !loopbackUrl(url)) {
    throw new ModelConfigError(
      `${name} must use https unless it targets a loopback host`,
    );
  }
  // replace：处理当前步骤。
  // toString：转换当前数据。
  return url.toString().replace(/\/+$/, "");
}

function timeoutMs(env: NodeJS.ProcessEnv): number {
  // value：处理当前步骤。
  const raw = value(env, "A4N_LLM_TIMEOUT_MS");
  if (!raw) {
    return 120_000;
  }
  // Number：转换数值。
  const parsed = Number(raw);
  // isSafeInteger：校验安全整数。
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 900_000) {
    throw new ModelConfigError(
      "A4N_LLM_TIMEOUT_MS must be an integer between 1000 and 900000",
    );
  }
  return parsed;
}

function selectDefaultModelId(
  explicitModel: string | undefined,
  keys: ProviderKeys,
): SupportedModelId {
  if (explicitModel) {
    // parseModelId：解析当前输入。
    return parseModelId(explicitModel);
  }
  if (keys.deepseek) {
    return DEFAULT_DEEPSEEK_MODEL_ID;
  }
  if (keys.longcat) {
    return DEFAULT_LONGCAT_MODEL_ID;
  }
  if (keys.kimi) {
    return DEFAULT_KIMI_MODEL_ID;
  }
  return DEFAULT_DEEPSEEK_MODEL_ID;
}

function providerRegistry(
  env: NodeJS.ProcessEnv,
  keys: ProviderKeys,
  fetchImpl?: typeof globalThis.fetch,
) {
  const fetchOption = fetchImpl ? { fetch: fetchImpl } : {};
  // createProviderRegistry：构造当前数据。
  // createDeepSeek：构造当前数据。
  // baseUrl：处理当前步骤。
  // createOpenAICompatible：构造当前数据。
  // baseUrl：处理当前步骤。
  // createOpenAICompatible：构造当前数据。
  // baseUrl：处理当前步骤。
  return createProviderRegistry({
    deepseek: createDeepSeek({
      apiKey: keys.deepseek ?? UNCONFIGURED_KEY,
      baseURL: baseUrl(env, "DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
      ...fetchOption,
    }),
    longcat: createOpenAICompatible({
      name: "longcat",
      apiKey: keys.longcat ?? UNCONFIGURED_KEY,
      baseURL: baseUrl(env, "LONGCAT_BASE_URL", DEFAULT_LONGCAT_BASE_URL),
      supportsStructuredOutputs: false,
      ...fetchOption,
    }),
    kimi: createOpenAICompatible({
      name: "kimi",
      apiKey: keys.kimi ?? UNCONFIGURED_KEY,
      baseURL: baseUrl(env, "KIMI_BASE_URL", DEFAULT_KIMI_BASE_URL),
      supportsStructuredOutputs: false,
      ...fetchOption,
    }),
  });
}

function generationOverrides(config: AgentConfig): GenerationParameters {
  const overrides: GenerationParameters = {};
  if (config.thinking !== undefined) {
    overrides.thinking = config.thinking;
  }
  if (config.temperature !== undefined) {
    overrides.temperature = config.temperature;
  }
  if (config.topP !== undefined) {
    overrides.topP = config.topP;
  }
  // parse：解析输入。
  return generationParametersSchema.parse(overrides);
}

function generationSettings(
  config: AgentConfig,
  defaultModelId: SupportedModelId,
): GenerationSettings {
  // safeParse：校验并解析输入。
  const parsed = agentConfigSchema.safeParse(config);
  if (!parsed.success || "topK" in config || "top_k" in config) {
    throw new KnownError(
      "llm-unavailable",
      "invalid or unsupported generation parameters",
      { retryable: false },
    );
  }
  const selectedModel = parsed.data.model ?? defaultModelId;
  // providerForModel：处理当前步骤。
  const isLongCat = providerForModel(selectedModel) === "longcat";
  if (parsed.data.thinking !== undefined && !isLongCat) {
    throw new KnownError(
      "llm-unavailable",
      "thinking control requires LongCat-2.0",
      { retryable: false },
    );
  }
  // generationOverrides：处理当前步骤。
  const overrides = generationOverrides(parsed.data);
  const parameters: GenerationParameters = {
    ...(isLongCat ? LONGCAT_STORY_PARAMETERS : {}),
    ...overrides,
  };
  const { thinking, ...sampling } = parameters;
  return {
    parameters,
    options: {
      ...sampling,
      ...(thinking !== undefined
        ? { providerOptions: { longcat: { thinking: { type: thinking } } } }
        : {}),
    },
  };
}

function languageModel(
  modelOverride: string | undefined,
  context: RuntimeContext,
): LanguageModel {
  let modelId: SupportedModelId;
  try {
    // parseModelId：解析当前输入。
    modelId =
      modelOverride === undefined
        ? context.defaultModelId
        : parseModelId(modelOverride);
  } catch (error) {
    throw new KnownError(
      "llm-unavailable",
      error instanceof Error ? error.message : "invalid model configuration",
      { retryable: false },
    );
  }
  // configured：处理当前步骤。
  if (!configured(modelId, context.keys)) {
    // providerForModel：处理当前步骤。
    const provider = providerForModel(modelId);
    throw new KnownError(
      "llm-unavailable",
      `LLM provider "${provider}" is not configured`,
      { retryable: false },
    );
  }
  // languageModel：处理当前步骤。
  return context.registry.languageModel(modelId);
}

export function createModelRuntime(
  env: NodeJS.ProcessEnv,
  deps: { fetch?: typeof globalThis.fetch } = {},
): ModelRuntime {
  // value：处理当前步骤。
  // value：处理当前步骤。
  // value：处理当前步骤。
  // value：处理当前步骤。
  const keys = {
    deepseek: value(env, "DEEPSEEK_API_KEY"),
    longcat: value(env, "LONGCAT_API_KEY"),
    kimi: value(env, "KIMI_API_KEY") ?? value(env, "MOONSHOT_API_KEY"),
  };
  // value：处理当前步骤。
  const explicitModel = value(env, "A4N_MODEL");
  // selectDefaultModelId：读取当前数据。
  const defaultModelId = selectDefaultModelId(explicitModel, keys);
  // configured：处理当前步骤。
  if (explicitModel && !configured(defaultModelId, keys)) {
    // providerForModel：处理当前步骤。
    const provider = providerForModel(defaultModelId);
    throw new ModelConfigError(
      `A4N_MODEL selects provider "${provider}" but its API key is missing`,
    );
  }
  // providerRegistry：处理当前步骤。
  const context: RuntimeContext = {
    defaultModelId,
    keys,
    registry: providerRegistry(env, keys, deps.fetch),
  };
  // configured：处理当前步骤。
  // timeoutMs：处理当前步骤。
  return {
    mode: configured(defaultModelId, keys) ? "live" : "demo",
    defaultModelId,
    requestTimeoutMs: timeoutMs(env),
    generationSettings(config: AgentConfig = {}) {
      // generationSettings：处理当前步骤。
      return generationSettings(config, defaultModelId);
    },
    languageModel(modelOverride?: string) {
      // languageModel：处理当前步骤。
      return languageModel(modelOverride, context);
    },
  };
}

// server 入口会在动态 import 本模块前载入 .env.local；测试可直接调用 factory 传合成 env。
// createModelRuntime：构造当前数据。
// bits:allow(BCS011): 生产组合根只读取一次环境并注入 ModelRuntime
export const modelRuntime = createModelRuntime(process.env);
