import { randomUUID } from "node:crypto";
import {
  runStep,
  stepExperimentRequestSchema,
  parseModelId,
} from "@agent4novel/contracts";
import type {
  ArtifactKind,
  StepExperimentRequest,
  StepExperimentResponse,
  StepExperimentRecording,
} from "@agent4novel/contracts";
import { ZodError } from "zod";
import { KnownError } from "../errors.js";
import { consumeGuards } from "../pipeline/consume-guards.js";
import { createCaptionStep } from "./caption-step.js";
import { createCreativeStep } from "./creative-step.js";
import { createOutlineStep } from "./outline-step.js";
import { createSettingStep } from "./setting-step.js";
import { createProseStep } from "./prose-step.js";
import { createBeatStep } from "./beat-step.js";
import { modelRuntime } from "./llm.js";
import { telemetryFor } from "./telemetry.js";
import {
  StepRecordError,
  StepRecorder,
  withStepRecorder,
} from "./step-record.js";

const factories = {
  caption: createCaptionStep,
  creative: createCreativeStep,
  outline: createOutlineStep,
  setting: createSettingStep,
  beat: createBeatStep,
  prose: createProseStep,
};
const consumes: Record<StepExperimentRequest["stepId"], ArtifactKind[]> = {
  caption: [],
  creative: ["caption"],
  outline: ["creative"],
  setting: ["caption", "creative", "outline"],
  beat: ["outline", "setting"],
  prose: ["beat", "setting"],
};

type RunBase = {
  runId: string;
  stepId: StepExperimentRequest["stepId"];
  executionMode: "live";
  model: string;
};
type StepResult = {
  content: Extract<StepExperimentResponse, { kind: "succeeded" }>["content"];
};

async function executeValidated(
  validated: StepExperimentRequest,
  runId: string,
) {
  // factories[validated.stepId]：创建当前 Step。
  const step = factories[validated.stepId]({
    systemPrompt: validated.systemPrompt,
  });
  const upstream = validated.input.upstream ?? {};
  for (const kind of consumes[validated.stepId]) {
    // consumeGuards[kind]：校验步骤输入。
    consumeGuards[kind]?.(upstream[kind]!);
  }
  // parse：解析输入。
  const input = step.inputSchema.parse({
    ...validated.input,
    upstream,
    workId: runId,
  });
  if (modelRuntime.mode !== "live") {
    throw new KnownError(
      "llm-unavailable",
      "Live model configuration required",
    );
  }
  // runStep：执行当前流程。
  return runStep(step, input, validated.config ?? {}) as Promise<StepResult>;
}

async function finishSuccess(
  recorder: StepRecorder | undefined,
  result: StepResult,
  base: RunBase,
): Promise<StepExperimentResponse> {
  // finish：处理当前步骤。
  // telemetryFor：记录当前观测。
  const recording = recorder
    ? await recorder.finish({
        status: "succeeded",
        content: result.content,
        code: null,
        retryable: null,
        telemetry: telemetryFor(base.runId),
      })
    : undefined;
  // telemetryFor：记录当前观测。
  return {
    ...base,
    kind: "succeeded",
    content: result.content,
    telemetry: telemetryFor(base.runId),
    ...(recording ? { recording } : {}),
  };
}

function failureCode(error: unknown): string {
  if (error instanceof ZodError) {
    return "invalid-input";
  }
  if (error instanceof StepRecordError) {
    return "recording-failed";
  }
  if (error instanceof KnownError) {
    return error.code;
  }
  return "step-failed";
}

async function finishFailure(
  recorder: StepRecorder | undefined,
  parsed: StepExperimentRequest | undefined,
  base: RunBase,
  error: unknown,
): Promise<StepExperimentResponse> {
  // failureCode：处理当前步骤。
  const code = failureCode(error);
  const retryable = error instanceof KnownError && error.retryable;
  let recording: StepExperimentRecording | undefined;
  if (recorder) {
    // finish：处理当前步骤。
    // telemetryFor：记录当前观测。
    recording = await recorder.finish({
      status: "failed",
      content: null,
      code,
      retryable,
      telemetry: telemetryFor(base.runId),
    });
  } else if (parsed?.record) {
    recording = {
      status: "failed",
      dir: parsed.record.dir,
      error:
        error instanceof StepRecordError
          ? error.reason
          : "recording-not-prepared",
    };
  }
  // telemetryFor：记录当前观测。
  return {
    ...base,
    kind: "failed",
    code,
    retryable,
    telemetry: telemetryFor(base.runId),
    ...(recording ? { recording } : {}),
  };
}

// Runs exactly one production step against supplied content. No work store or
// pipeline is created.
export async function runIsolatedStep(
  request: StepExperimentRequest,
): Promise<StepExperimentResponse> {
  // randomUUID：生成随机 ID。
  const runId = `experiment-${randomUUID()}`;
  const selectedModel = request.config?.model ?? modelRuntime.defaultModelId;
  // parseModelId：解析当前输入。
  const base: RunBase = {
    runId,
    stepId: request.stepId,
    executionMode: "live",
    model: parseModelId(selectedModel) ?? "unrecognized-model",
  };
  let recorder: StepRecorder | undefined;
  let parsed: StepExperimentRequest | undefined;
  try {
    // parse：解析输入。
    parsed = stepExperimentRequestSchema.parse(request);
    if (parsed.record) {
      // start：执行当前流程。
      recorder = await StepRecorder.start({
        request: parsed.record,
        input: parsed.input,
        runId,
        stepId: parsed.stepId,
        model: base.model,
      });
    }
    // executeValidated：执行当前流程。
    const execute = () => executeValidated(parsed!, runId);
    // withStepRecorder：处理当前步骤。
    // execute：执行当前流程。
    const result = recorder
      ? await withStepRecorder(recorder, execute)
      : await execute();
    // finishSuccess：处理当前步骤。
    return await finishSuccess(recorder, result, base);
  } catch (error) {
    // finishFailure：处理当前步骤。
    return finishFailure(recorder, parsed, base, error);
  }
}
