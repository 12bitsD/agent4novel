import { randomUUID } from "node:crypto";
import type {
  Artifact,
  BeatExecutionObservation,
  BeatOperation,
  ChapterRegenerationBinding,
  ProseExecutionObservation,
  ProseOperation,
} from "@agent4novel/contracts";
import { z } from "zod";
import { KnownError } from "./errors.js";
import { currentRequest, recordCommand } from "./steps/telemetry.js";

type Stage = NonNullable<
  | BeatExecutionObservation["failureStage"]
  | ProseExecutionObservation["failureStage"]
>;

const prewriteErrorCodes = [
  "version-conflict",
  "upstream-changed",
  "artifact-already-approved",
  "work-not-found",
];

type CommandFailureObservation = {
  writeOutcome: "unknown" | "not-committed";
  failureStage: Stage;
};

// 按失败阶段判定写入是明确未提交还是结果未知。
export function commandFailureObservation(
  cause: unknown,
  failureStage: Stage,
): CommandFailureObservation {
  // includes：检查包含关系。
  const prewrite =
    cause instanceof KnownError && prewriteErrorCodes.includes(cause.code);
  return {
    writeOutcome:
      failureStage === "response" || (failureStage === "commit" && !prewrite)
        ? "unknown"
        : "not-committed",
    failureStage,
  };
}

type Command = BeatExecutionObservation | ProseExecutionObservation;
type CommandExecution = {
  stage: Stage;
  enter: (stage: Stage) => void;
};
type CommandTarget = {
  workId: string;
  chapter?: number;
  regeneration?: ChapterRegenerationBinding;
};
type CommandBaseContext = {
  kind: "beat" | "prose";
  target: CommandTarget;
  operation: BeatOperation | ProseOperation;
  expectedHead: Command["expectedHead"];
};

// 把领域异常和 schema 异常映射为稳定的公开错误码。
export function commandFailureCode(cause: unknown, stage: Stage): string {
  if (stage === "response") {
    return "internal-error";
  }
  if (cause instanceof KnownError) {
    return cause.code;
  }
  if (!(cause instanceof z.ZodError)) {
    return "internal-error";
  }
  if (stage === "output" || stage === "model") {
    return "llm-invalid-output";
  }
  return "invalid-content";
}

// 用请求快照和遥测游标构造本次命令的基础观测。
export function commandBase(
  context: CommandBaseContext,
  request: ReturnType<typeof currentRequest>,
  started: number,
  cursor: number,
) {
  // randomUUID：生成随机 ID。
  // now：读取当前时间。
  // map：转换数组元素。
  // filter：筛选元素。
  // slice：截取片段。
  return {
    kind: "execution-result" as const,
    requestId: request?.requestId ?? randomUUID(),
    operation: context.operation,
    target: {
      workId: context.target.workId,
      kind: context.kind,
      chapter: context.target.chapter ?? 1,
    },
    expectedHead: context.expectedHead,
    ...(context.target.regeneration
      ? { regeneration: context.target.regeneration }
      : {}),
    executionMode: request?.executionMode ?? ("demo" as const),
    latencyMs: Date.now() - started,
    attemptIds:
      request?.telemetry
        .slice(cursor)
        .filter((item) => item.stepId === context.kind)
        .map((item) => item.attemptId) ?? [],
  };
}

// 记录失败命令并保留原错误分类，由领域适配层抛出。
export function failedCommand(input: {
  workId: string;
  cause: unknown;
  execution: CommandExecution;
  base: () => object;
  failureCode: (cause: unknown, stage: Stage) => string;
}): { code: string; command: Command } {
  if (
    input.cause instanceof KnownError &&
    input.cause.code === "input-budget-exceeded"
  ) {
    // enter：标记执行阶段。
    input.execution.enter("input");
  }
  // failureCode：处理当前步骤。
  if (input.failureCode(input.cause, input.execution.stage) === "llm-invalid-output") {
    // enter：标记执行阶段。
    input.execution.enter("output");
  }
  // failureCode：处理当前步骤。
  const code = input.failureCode(input.cause, input.execution.stage);
  // 构造失败观测，保留失败阶段和写入结果。
  // base：处理当前步骤。
  // commandFailureObservation：处理当前步骤。
  const command = {
    ...input.base(),
    ...commandFailureObservation(input.cause, input.execution.stage),
  } as Command;
  // recordCommand：写入当前结果。
  recordCommand(input.workId, command, code);
  return { code, command };
}

// 响应构造失败时，将已执行命令改记为结果未知。
export function responseErrorObservation<Observation extends Command>(input: {
  workId: string;
  committed: Observation;
  cause: unknown;
  code: string;
}): Observation {
  const { resultHead: _resultHead, ...executed } = input.committed;
  // currentRequest：读取当前数据。
  const request = currentRequest();
  // 丢弃 resultHead，改记响应阶段失败。
  // commandFailureObservation：处理当前步骤。
  // now：读取当前时间。
  const command = {
    ...executed,
    ...commandFailureObservation(input.cause, "response"),
    latencyMs: request ? Date.now() - request.startedAt : executed.latencyMs,
  } as Observation;
  // recordCommand：写入当前结果。
  recordCommand(input.workId, command, input.code);
  return command;
}

// 执行命令并统一记录成功、失败和响应阶段观测。
export async function observeCommand<
  Observation extends Command,
  T extends Artifact,
>(input: {
  kind: "beat" | "prose";
  target: CommandTarget;
  operation: BeatOperation | ProseOperation;
  expectedHead: Observation["expectedHead"];
  run: (execution: CommandExecution) => T | Promise<T>;
  schema: { parse: (data: unknown) => Observation };
  failureCode: (cause: unknown, stage: Stage) => string;
  error: (cause: unknown, command: Observation) => Error;
}): Promise<{ artifact: T; command: Observation }> {
  // currentRequest：读取当前数据。
  const request = currentRequest();
  // now：读取当前时间。
  const started = Date.now();
  const cursor = request?.telemetry.length ?? 0;
  const execution: CommandExecution = {
    stage: "precondition",
    enter(stage) {
      this.stage = stage;
    },
  };
  // 固定请求起点，避免纳入后续请求的遥测。
  // commandBase：处理当前步骤。
  const base = () => commandBase(input, request, started, cursor);
  try {
    // run：执行流程。
    const artifact = await input.run(execution);
    // enter：标记执行阶段。
    execution.enter("response");
    // parse：解析输入。
    // base：处理当前步骤。
    const command = input.schema.parse({
      ...base(),
      writeOutcome: "committed",
      resultHead: {
        artifactId: artifact.id,
        version: artifact.version,
        humanStatus: artifact.humanStatus,
      },
    });
    // recordCommand：写入当前结果。
    recordCommand(input.target.workId, command, "ok");
    return { artifact, command };
  } catch (cause) {
    // 统一记录失败，再交由适配层抛出领域错误。
    // failedCommand：处理当前步骤。
    const failure = failedCommand({
      workId: input.target.workId,
      cause,
      execution,
      base,
      failureCode: input.failureCode,
    });
    // error：处理当前步骤。
    throw input.error(cause, failure.command as Observation);
  }
}
