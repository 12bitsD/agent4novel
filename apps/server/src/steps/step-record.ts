import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  stepExperimentRecordFiles as FILES,
  stepExperimentRecordInvocationSchema,
  makeStepExperimentRecordInput,
  makeEmptyStepExperimentRecordInvocation,
  makeStepExperimentRecordResult,
  makeStepExperimentRecordMeta,
} from "@agent4novel/contracts";
import type {
  StepExperimentRecordRequest,
  StepExperimentRecording,
  StepExperimentRequest,
} from "@agent4novel/contracts";

export class StepRecordError extends Error {
  readonly code = "recording-failed";
  constructor(readonly reason: string) {
    // super：初始化父类错误。
    super("step record could not be prepared or written");
    this.name = "StepRecordError";
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function ensurePrivateDirectory(dir: string): Promise<void> {
  try {
    // lstat：处理当前步骤。
    const entry = await lstat(dir);
    // isDirectory：校验当前条件。
    // isSymbolicLink：校验当前条件。
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new StepRecordError("record-directory-not-private");
    }
    if ((entry.mode & 0o077) !== 0) {
      throw new StepRecordError("record-directory-permissions");
    }
  } catch (error) {
    if (error instanceof StepRecordError) {
      throw error;
    }
    // isNodeError：校验当前条件。
    throw new StepRecordError(
      isNodeError(error, "ENOENT")
        ? "record-directory-missing"
        : "record-directory-unreadable",
    );
  }
}

async function writeJsonExclusive(
  dir: string,
  name: string,
  value: unknown,
): Promise<void> {
  // join：拼接文本。
  const target = join(dir, name);
  // join：拼接文本。
  // randomUUID：生成随机 ID。
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    try {
      // lstat：处理当前步骤。
      await lstat(target);
      throw new StepRecordError(`record-file-collision:${name}`);
    } catch (error) {
      if (error instanceof StepRecordError) {
        throw error;
      }
      // isNodeError：校验当前条件。
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    }
    // writeFile：写入当前结果。
    // stringify：序列化数据。
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // chmod：处理当前步骤。
    await chmod(temporary, 0o600);
    // rename(2) replaces an existing target on POSIX. A hard-link create is
    // atomic and fails with EEXIST instead, so a late collision cannot change
    // an existing record file.
    // link：处理当前步骤。
    await link(temporary, target);
    // unlink：处理当前步骤。
    await unlink(temporary);
    // chmod：处理当前步骤。
    await chmod(target, 0o600);
  } catch (error) {
    try {
      // unlink：处理当前步骤。
      await unlink(temporary);
    } catch (cleanupError) {
      void cleanupError;
    }
    if (error instanceof StepRecordError) {
      throw error;
    }
    // isNodeError：校验当前条件。
    throw new StepRecordError(
      isNodeError(error, "EEXIST")
        ? `record-file-collision:${name}`
        : `record-write-failed:${name}`,
    );
  }
}

async function replaceJson(
  dir: string,
  name: string,
  value: unknown,
): Promise<void> {
  // join：拼接文本。
  const target = join(dir, name);
  // join：拼接文本。
  // randomUUID：生成随机 ID。
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    // lstat：处理当前步骤。
    const existing = await lstat(target);
    // isFile：校验当前条件。
    // isSymbolicLink：校验当前条件。
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new StepRecordError(`record-file-not-regular:${name}`);
    }
    // writeFile：写入当前结果。
    // stringify：序列化数据。
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // chmod：处理当前步骤。
    await chmod(temporary, 0o600);
    // rename：处理当前步骤。
    await rename(temporary, target);
    // chmod：处理当前步骤。
    await chmod(target, 0o600);
  } catch (error) {
    if (error instanceof StepRecordError) {
      throw error;
    }
    // isNodeError：校验当前条件。
    throw new StepRecordError(
      isNodeError(error, "ENOENT")
        ? `record-file-missing:${name}`
        : `record-write-failed:${name}`,
    );
  }
}

export class StepRecorder {
  private constructor(
    private readonly context: {
      request: StepExperimentRecordRequest;
      runId: string;
      stepId: StepExperimentRequest["stepId"];
      model: string;
      startedAt: string;
    },
  ) {}

  static async start(args: {
    request: StepExperimentRecordRequest;
    input: StepExperimentRequest["input"];
    runId: string;
    stepId: StepExperimentRequest["stepId"];
    model: string;
  }): Promise<StepRecorder> {
    // ensurePrivateDirectory：处理当前步骤。
    await ensurePrivateDirectory(args.request.dir);
    // toISOString：转换当前数据。
    const recorder = new StepRecorder({
      request: args.request,
      runId: args.runId,
      stepId: args.stepId,
      model: args.model,
      startedAt: new Date().toISOString(),
    });
    // makeStepExperimentRecordInput：构造当前数据。
    const input = makeStepExperimentRecordInput(
      args.input,
      args.request.sources,
    );
    // writeJsonExclusive：写入当前结果。
    await writeJsonExclusive(args.request.dir, FILES.input, input);
    // writeJsonExclusive：写入当前结果。
    // makeEmptyStepExperimentRecordInvocation：构造当前数据。
    await writeJsonExclusive(
      args.request.dir,
      FILES.invocation,
      makeEmptyStepExperimentRecordInvocation(),
    );
    // writeJsonExclusive：写入当前结果。
    // meta：处理当前步骤。
    await writeJsonExclusive(
      args.request.dir,
      FILES.meta,
      recorder.meta("partial", "in-progress", null),
    );
    return recorder;
  }

  async captureInvocation(value: {
    system: string;
    prompt: string;
    model: string;
    attemptId: string;
    effectiveConfig: {
      model: string | null;
      directionCount: number | null;
      thinking: "enabled" | "disabled" | null;
      temperature: number | null;
      topP: number | null;
    };
    generation: {
      thinking: "enabled" | "disabled" | null;
      temperature: number | null;
      topP: number | null;
    };
    sdkOptions: {
      temperature: number | null;
      topP: number | null;
      providerOptions: unknown;
    };
    maxOutputTokens: number;
    maxRetries: number | null;
    requestTimeoutMs: number;
  }): Promise<void> {
    // parse：解析输入。
    // toISOString：转换当前数据。
    const invocation = stepExperimentRecordInvocationSchema.parse({
      formatVersion: 1,
      captured: true,
      capturedAt: new Date().toISOString(),
      ...value,
    });
    // replaceJson：处理当前步骤。
    await replaceJson(this.context.request.dir, FILES.invocation, invocation);
  }

  // bits:allow(BCS004): finish 的 retryable 是记录结果字段，不是行为切换开关
  async finish(args: {
    status: "succeeded" | "failed" | "unknown";
    content: unknown;
    code: string | null;
    retryable: boolean | null;
    telemetry: unknown[];
  }): Promise<StepExperimentRecording> {
    try {
      // makeStepExperimentRecordResult：构造当前数据。
      const result = makeStepExperimentRecordResult(args);
      // writeJsonExclusive：写入当前结果。
      await writeJsonExclusive(this.context.request.dir, FILES.result, result);
      // replaceJson：处理当前步骤。
      // meta：处理当前步骤。
      // toISOString：转换当前数据。
      await replaceJson(
        this.context.request.dir,
        FILES.meta,
        this.meta("final", "complete", new Date().toISOString()),
      );
      return { status: "complete", dir: this.context.request.dir, error: null };
    } catch (error) {
      return {
        status: "failed",
        dir: this.context.request.dir,
        error:
          error instanceof StepRecordError
            ? error.reason
            : "record-write-failed",
      };
    }
  }

  private meta(
    completion: "partial" | "final",
    status: "in-progress" | "complete" | "incomplete",
    finishedAt: string | null,
  ) {
    // makeStepExperimentRecordMeta：构造当前数据。
    return makeStepExperimentRecordMeta({
      complete: completion === "final",
      status,
      runId: this.context.runId,
      stepId: this.context.stepId,
      model: this.context.model,
      startedAt: this.context.startedAt,
      finishedAt,
      gitCommit: this.context.request.version.gitCommit,
      gitDirty: this.context.request.version.gitDirty,
      sources: this.context.request.sources,
    });
  }
}

const currentRecorder = new AsyncLocalStorage<StepRecorder>();
export function withStepRecorder<T>(
  recorder: StepRecorder,
  run: () => Promise<T>,
): Promise<T> {
  // run：执行流程。
  return currentRecorder.run(recorder, run);
}
export function currentStepRecorder(): StepRecorder | undefined {
  // getStore：读取当前数据。
  return currentRecorder.getStore();
}
