import {
  commandSummarySchema,
  diagnosticResponseSchema,
} from "@agent4novel/contracts";
import type {
  LlmTelemetry,
  BeatCommandObservation,
  ProseCommandObservation,
  CommandSummary,
  DiagnosticQuery,
} from "@agent4novel/contracts";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { safeLog } from "../safe-log.js";

type RequestScope = {
  requestId: string;
  executionMode: "demo" | "live";
  telemetry: LlmTelemetry[];
  startedAt: number;
};
const requests = new AsyncLocalStorage<RequestScope>();
// getStore：读取当前数据。
export const currentRequest = () => requests.getStore();
export function withRequest<T>(
  requestId: string,
  executionMode: RequestScope["executionMode"],
  run: (scope: RequestScope) => T,
): T {
  // now：读取当前时间。
  const scope: RequestScope = {
    requestId,
    executionMode,
    telemetry: [],
    startedAt: Date.now(),
  };
  // run：执行流程。
  // run：执行流程。
  return requests.run(scope, () => run(scope));
}

// LLM 遥测按 request scope 内联本次命令响应，并写入进程级环形缓冲供诊断查询。
// request scope 只覆盖单次请求；进程缓冲不持久化，重启即丢失。
const CAPACITY = 1000;
// randomUUID：生成随机 ID。
const telemetryState = {
  seq: 0,
  commandSeq: 0,
  processInstanceId: randomUUID(),
};
type Entry = { seq: number; workId: string } & LlmTelemetry;
const entries: Entry[] = [];
const commands: Array<{ workId: string; seq: number } & CommandSummary> = [];

export function recordCommand(
  workId: string,
  command: BeatCommandObservation | ProseCommandObservation,
  code: string,
): void {
  try {
    // parse：解析输入。
    // toISOString：转换当前数据。
    const summary = commandSummarySchema.parse({
      command,
      code,
      recordedAt: new Date().toISOString(),
    });
    // push：追加元素。
    commands.push({ workId, seq: ++telemetryState.commandSeq, ...summary });
    if (commands.length > CAPACITY) {
      // splice：处理当前步骤。
      commands.splice(0, commands.length - CAPACITY);
    }
    // safeLog：处理当前步骤。
    // endsWith：处理当前步骤。
    safeLog({
      event: command.operation.endsWith("-prose")
        ? "prose.command"
        : "beat.command",
      ...summary,
    });
  } catch (error) {
    void error;
  }
}
export function diagnosticsFor(workId: string, query: DiagnosticQuery = {}) {
  // at：处理当前步骤。
  const windowOf = (items: Array<{ seq: number }>, latest: number) => ({
    capacity: 1000 as const,
    oldestSeq: items[0]?.seq ?? null,
    latestSeq: items.at(-1)?.seq ?? null,
    truncated: latest > CAPACITY,
  });
  // parse：解析输入。
  // filter：筛选元素。
  // telemetryFor：记录当前观测。
  // map：转换数组元素。
  // filter：筛选元素。
  // includes：检查包含关系。
  // windowOf：处理当前步骤。
  // windowOf：处理当前步骤。
  return diagnosticResponseSchema.parse({
    workId,
    telemetry: telemetryFor(workId).filter(
      (t) =>
        (!query.requestId || t.requestId === query.requestId) &&
        (!query.attemptId || t.attemptId === query.attemptId),
    ),
    commands: commands
      .filter(
        (c) =>
          c.workId === workId &&
          (!query.requestId || c.command.requestId === query.requestId) &&
          (!query.attemptId || c.command.attemptIds.includes(query.attemptId)),
      )
      .map(({ workId: _workId, seq: _seq, ...summary }) => summary),
    window: {
      processInstanceId: telemetryState.processInstanceId,
      retention: "process-memory",
      llm: windowOf(entries, telemetryState.seq),
      commands: windowOf(commands, telemetryState.commandSeq),
    },
  });
}

export function recordTelemetry(workId: string, t: LlmTelemetry): void {
  try {
    // currentRequest：读取当前数据。
    const scope = currentRequest();
    // structuredClone：深拷贝数据。
    const record = structuredClone({
      ...t,
      ...(scope ? { requestId: scope.requestId } : {}),
    });
    if (scope && scope.telemetry.length < CAPACITY) {
      // push：追加元素。
      scope.telemetry.push(record);
    }
    // push：追加元素。
    entries.push({ seq: ++telemetryState.seq, workId, ...record });
    if (entries.length > CAPACITY) {
      // splice：处理当前步骤。
      entries.splice(0, entries.length - CAPACITY);
    }
  } catch (error) {
    void error;
  }
}

export function telemetryFor(workId: string, afterSeq = 0): LlmTelemetry[] {
  // map：转换数组元素。
  // filter：筛选元素。
  return entries
    .filter((e) => e.workId === workId && e.seq > afterSeq)
    .map(({ seq: _seq, workId: _workId, ...t }) => t);
}

// 测试专用:清空账本
export function resetTelemetry(): void {
  entries.length = 0;
  telemetryState.seq = 0;
  commands.length = 0;
  telemetryState.commandSeq = 0;
  // randomUUID：生成随机 ID。
  telemetryState.processInstanceId = randomUUID();
}
