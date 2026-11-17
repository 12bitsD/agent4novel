import { beatCommandObservationSchema } from "@agent4novel/contracts";
import type {
  Artifact,
  BeatExecutionObservation,
  BeatOperation,
  ChapterRegenerationBinding,
} from "@agent4novel/contracts";
import {
  commandFailureCode,
  observeCommand,
  responseErrorObservation,
} from "./command-observation.js";

type Stage = NonNullable<BeatExecutionObservation["failureStage"]>;
export type BeatExecution = {
  stage: Stage;
  enter: (stage: Stage) => void;
};
export type BeatTarget = {
  workId: string;
  chapter?: number;
  regeneration?: ChapterRegenerationBinding;
};

export function beatFailureCode(cause: unknown, stage: Stage): string {
  // 使用统一的阶段错误分类。
  // commandFailureCode：处理当前步骤。
  return commandFailureCode(cause, stage);
}

export class BeatCommandError extends Error {
  constructor(
    readonly cause: unknown,
    readonly command: BeatExecutionObservation,
  ) {
    // super：初始化父类。
    super("beat command failed");
  }
}

export function beatResponseError(
  workId: string,
  committed: BeatExecutionObservation,
  cause: unknown,
): BeatCommandError {
  // 已执行但未返回时，标记 Beat 响应结果未知。
  // responseErrorObservation：处理当前步骤。
  const command = responseErrorObservation({
    workId,
    committed,
    cause,
    code: "internal-error",
  });
  return new BeatCommandError(cause, command);
}

export async function observeBeat<T extends Artifact>(
  target: BeatTarget,
  operation: BeatOperation,
  expectedHead: BeatExecutionObservation["expectedHead"],
  run: (execution: BeatExecution) => T | Promise<T>,
): Promise<{ artifact: T; command: BeatExecutionObservation }> {
  // 共享观测流程；这里只注入 Beat 的 schema 和错误类型。
  // observeCommand：记录当前观测。
  // parse：解析输入。
  return observeCommand({
    kind: "beat",
    target,
    operation,
    expectedHead,
    run,
    schema: {
      parse: (data: unknown) =>
        beatCommandObservationSchema.parse(data) as BeatExecutionObservation,
    },
    failureCode: beatFailureCode,
    error: (cause, command) => new BeatCommandError(cause, command),
  });
}
