import { proseCommandObservationSchema } from "@agent4novel/contracts";
import type {
  Artifact,
  ProseExecutionObservation,
  ProseOperation,
  ChapterRegenerationBinding,
} from "@agent4novel/contracts";
import {
  commandFailureCode,
  observeCommand,
  responseErrorObservation,
} from "./command-observation.js";

type Stage = NonNullable<ProseExecutionObservation["failureStage"]>;
export type ProseExecution = {
  stage: Stage;
  enter: (stage: Stage) => void;
};
export type ProseTarget = {
  workId: string;
  chapter?: number;
  regeneration?: ChapterRegenerationBinding;
};

export function proseFailureCode(cause: unknown, stage: Stage): string {
  // 使用统一的阶段错误分类。
  // commandFailureCode：处理当前步骤。
  return commandFailureCode(cause, stage);
}

export class ProseCommandError extends Error {
  constructor(
    readonly cause: unknown,
    readonly command: ProseExecutionObservation,
  ) {
    // super：初始化父类。
    super("prose command failed");
  }
}

export function proseResponseError(
  workId: string,
  committed: ProseExecutionObservation,
  cause: unknown,
): ProseCommandError {
  // 已执行但未返回时，标记 Prose 响应结果未知。
  // responseErrorObservation：处理当前步骤。
  // proseFailureCode：处理当前步骤。
  const command = responseErrorObservation({
    workId,
    committed,
    cause,
    code: proseFailureCode(cause, "response"),
  });
  return new ProseCommandError(cause, command);
}

export async function observeProse<T extends Artifact>(
  target: ProseTarget,
  operation: ProseOperation,
  expectedHead: ProseExecutionObservation["expectedHead"],
  run: (execution: ProseExecution) => T | Promise<T>,
): Promise<{ artifact: T; command: ProseExecutionObservation }> {
  // 共享观测流程；这里只注入 Prose 的 schema 和错误类型。
  // observeCommand：记录当前观测。
  // parse：解析输入。
  return observeCommand({
    kind: "prose",
    target,
    operation,
    expectedHead,
    run,
    schema: {
      parse: (data: unknown) =>
        proseCommandObservationSchema.parse(data) as ProseExecutionObservation,
    },
    failureCode: proseFailureCode,
    error: (cause, command) => new ProseCommandError(cause, command),
  });
}
