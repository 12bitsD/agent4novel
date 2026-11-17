import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import {
  seedCharBudget,
  authorConfigLimits,
  agentConfigSchema,
  parseModelId,
} from "@agent4novel/contracts";
import type { AgentConfig, GenerationParameters } from "@agent4novel/contracts";
import type { z } from "zod";
import { KnownError } from "../errors.js";
import { modelRuntime } from "./llm.js";
import type { GenerationSettings } from "./llm.js";
import { recordTelemetry, currentRequest } from "./telemetry.js";
import { safeLog } from "../safe-log.js";
import { currentStepRecorder, StepRecordError } from "./step-record.js";

// 提示词以文件维护(ADR-0002),各 step 一个目录,此处共享 loader,模块级缓存
const skillCache = new Map<string, string>();
export function loadSkill(stepId: string): string {
  // get：读取值。
  let text = skillCache.get(stepId);
  if (!text) {
    // readFileSync：读取当前数据。
    text = readFileSync(
      new URL(`./skills/${stepId}/SKILL.md`, import.meta.url),
      "utf8",
    );
    // set：写入值。
    skillCache.set(stepId, text);
  }
  return text;
}

export function systemFor(
  stepId: string,
  config: AgentConfig,
  override?: string,
): string {
  // loadSkill：读取当前数据。
  const base = override ?? loadSkill(stepId);
  const system = config.systemPrompt
    ? `${base}\n\nAuthor writing guidance (output contracts still apply):\n${config.systemPrompt}`
    : base;
  // Managed author files have their own limit. The isolated experiment's
  // explicit SP override retains its existing assembled-input budget.
  if (
    config.configRevision !== undefined &&
    system.length > authorConfigLimits.systemChars
  ) {
    throw new KnownError(
      "config-invalid",
      "assembled author system context exceeds budget",
    );
  }
  return system;
}

// 超长素材统一截断点(#3c 决策 17):caption/creative 共用;budget 单源在 contracts/limits.ts
export function truncateSeed(seed: string): string {
  // slice：截取片段。
  return seed.length > seedCharBudget ? seed.slice(0, seedCharBudget) : seed;
}

function hash12(text: string): string {
  // slice：截取片段。
  // digest：处理当前步骤。
  // update：写入当前结果。
  // createHash：构造当前数据。
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// includes：检查包含关系。
const safeFinish = (value: unknown) =>
  typeof value === "string" &&
  [
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
    "unknown",
  ].includes(value)
    ? value
    : "unknown";
// isSafeInteger：校验安全整数。
const safeTokens = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

function configurationError(
  error: unknown,
  details: { code?: unknown },
): boolean {
  if (details.code === "llm-config-invalid") {
    return true;
  }
  if (!(error instanceof KnownError)) {
    return false;
  }
  return !error.retryable && error.code === "llm-unavailable";
}

function outputSchemaName(name: string): boolean {
  // includes：检查包含关系。
  // includes：检查包含关系。
  return (
    name.includes("NoObjectGeneratedError") ||
    ["AI_TypeValidationError", "ZodError"].includes(name)
  );
}

function classify(error: unknown): string {
  const details = error as {
    name?: string;
    finishReason?: unknown;
    code?: unknown;
    data?: { error?: { code?: unknown } };
  };
  const name = typeof details?.name === "string" ? details.name : "";
  // includes：检查包含关系。
  if (["TimeoutError", "AbortError"].includes(name)) {
    return "timeout";
  }
  // configurationError：处理当前步骤。
  if (configurationError(error, details)) {
    return "configuration";
  }
  const providerCode = details?.data?.error?.code;
  const contextCodes = ["context_length_exceeded", "max_context_length"];
  // includes：检查包含关系。
  // String：转换字符串。
  if (contextCodes.includes(String(providerCode))) {
    return "context-limit";
  }
  if (details?.finishReason === "length") {
    return "output-truncated";
  }
  // outputSchemaName：处理当前步骤。
  if (outputSchemaName(name)) {
    return "output-schema";
  }
  // includes：检查包含关系。
  if (["TypeError", "AI_APICallError", "AI_RetryError"].includes(name)) {
    return "network";
  }
  return "unknown";
}

type LlmArgs<T> = {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  config: AgentConfig;
  workId: string;
  stepId: string;
  chapter?: number;
  attemptId: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  effectiveConfig?: { directionCount?: number };
};

type CallContext<T> = {
  args: LlmArgs<T>;
  base: ReturnType<typeof telemetryBase>;
  generation?: GenerationParameters;
  started: number;
};

function telemetryBase<T>(args: LlmArgs<T>) {
  const model = args.config.model ?? modelRuntime.defaultModelId;
  // safeParse：校验并解析输入。
  // pick：处理当前步骤。
  const provenance = agentConfigSchema
    .pick({ configRevision: true, configFiles: true })
    .safeParse({
      configRevision: args.config.configRevision,
      configFiles: args.config.configFiles,
    });
  // currentRequest：读取当前数据。
  const request = currentRequest();
  // parseModelId：解析当前输入。
  // hash12：校验当前条件。
  // hash12：校验当前条件。
  return {
    stepId: args.stepId,
    ...(args.chapter !== undefined ? { chapter: args.chapter } : {}),
    attemptId: args.attemptId,
    model: parseModelId(model) ?? "unrecognized-model",
    ...(request ? { requestId: request.requestId } : {}),
    promptChars: args.prompt.length,
    promptHash: hash12(args.prompt),
    systemHash: hash12(args.system),
    ...(provenance.success ? provenance.data : {}),
  };
}

async function captureInvocation<T>(
  args: LlmArgs<T>,
  model: string,
  settings: GenerationSettings,
): Promise<void> {
  // captureInvocation：处理当前步骤。
  // currentStepRecorder：读取当前数据。
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
  });
}

function successTelemetry<T>(
  context: CallContext<T>,
  result: {
    usage?: { inputTokens?: number; outputTokens?: number };
    finishReason: unknown;
  },
) {
  // now：读取当前时间。
  // safeTokens：处理当前步骤。
  // safeTokens：处理当前步骤。
  // safeFinish：处理当前步骤。
  return {
    ...context.base,
    ...(context.generation ? { generation: context.generation } : {}),
    ok: true as const,
    latencyMs: Date.now() - context.started,
    inputTokens: safeTokens(result.usage?.inputTokens),
    outputTokens: safeTokens(result.usage?.outputTokens),
    finishReason: safeFinish(result.finishReason),
  };
}

function failureTelemetry<T>(context: CallContext<T>, error: unknown) {
  const details = error as {
    finishReason?: string;
    usage?: { outputTokens?: number };
    text?: string;
  };
  // now：读取当前时间。
  // classify：处理当前步骤。
  // safeTokens：处理当前步骤。
  // safeFinish：处理当前步骤。
  const telemetry = {
    ...context.base,
    ...(context.generation ? { generation: context.generation } : {}),
    ok: false as const,
    latencyMs: Date.now() - context.started,
    error: classify(error),
    outputTokens: safeTokens(details?.usage?.outputTokens),
    finishReason: safeFinish(details?.finishReason),
  };
  // recordTelemetry：写入当前结果。
  recordTelemetry(context.args.workId, telemetry);
  // safeLog：处理当前步骤。
  safeLog({
    event: "llm.error",
    ...telemetry,
    textChars:
      typeof details?.text === "string" ? details.text.length : undefined,
  });
}

function translatedError(error: unknown, attemptId: string): KnownError {
  const name = error instanceof Error ? error.name : "";
  // includes：检查包含关系。
  if (["TimeoutError", "AbortError"].includes(name)) {
    return new KnownError("llm-timeout", "llm request timed out", {
      retryable: true,
      attemptId,
    });
  }
  // outputSchemaName：处理当前步骤。
  if (outputSchemaName(name)) {
    return new KnownError(
      "llm-invalid-output",
      "llm output failed schema validation",
      { retryable: true, attemptId },
    );
  }
  return new KnownError("llm-unavailable", "llm request unavailable", {
    retryable: error instanceof KnownError ? error.retryable : true,
    attemptId,
  });
}

// 日志只记 attemptId/model/latency/token/finishReason/长度+hash,不落素材/prompt 全文。
export async function callLlm<T>(args: LlmArgs<T>): Promise<T> {
  const model = args.config.model ?? modelRuntime.defaultModelId;
  // telemetryBase：记录当前观测。
  // now：读取当前时间。
  const context: CallContext<T> = {
    args,
    base: telemetryBase(args),
    started: Date.now(),
  };
  try {
    // languageModel：处理当前步骤。
    const languageModel = modelRuntime.languageModel(model);
    // generationSettings：处理当前步骤。
    const settings = modelRuntime.generationSettings(args.config);
    context.generation = settings.parameters;
    // captureInvocation：处理当前步骤。
    await captureInvocation(args, model, settings);
    // generateObject：处理当前步骤。
    // timeout：处理当前步骤。
    const result = await generateObject({
      model: languageModel,
      ...settings.options,
      schema: args.schema,
      system: args.system,
      prompt: args.prompt,
      maxOutputTokens: args.maxOutputTokens ?? 8000,
      ...(args.maxRetries !== undefined ? { maxRetries: args.maxRetries } : {}),
      abortSignal: AbortSignal.timeout(modelRuntime.requestTimeoutMs),
    });
    if (result.finishReason === "length") {
      // assign：合并对象。
      throw Object.assign(new Error("output truncated"), {
        name: "AI_NoObjectGeneratedError",
        finishReason: result.finishReason,
        usage: result.usage,
      });
    }
    // parse：解析输入。
    const validated = args.schema.parse(result.object);
    // successTelemetry：处理当前步骤。
    const telemetry = successTelemetry(context, result);
    // recordTelemetry：写入当前结果。
    recordTelemetry(args.workId, telemetry);
    // safeLog：处理当前步骤。
    safeLog({ event: "llm.call", ...telemetry });
    return validated;
  } catch (error) {
    if (error instanceof StepRecordError) {
      throw error;
    }
    // failureTelemetry：处理当前步骤。
    failureTelemetry(context, error);
    // translatedError：处理当前步骤。
    throw translatedError(error, args.attemptId);
  }
}
