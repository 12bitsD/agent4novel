import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  stepExperimentRequestSchema,
  stepExperimentResponseSchema,
} from "@agent4novel/contracts";
import type { StepExperimentRequest } from "@agent4novel/contracts";
import { CliError } from "./client.js";
import { readBoundedText, readRequestJson } from "./request-file.js";
import {
  makeStepRecordRequest,
  markStepRecordUnknown,
  reserveStepRecordDir,
} from "./step-record.js";

const FILE_BYTES = 1024 * 1024;
const RESULT_BYTES = 8 * FILE_BYTES;
const DEFAULT_STEP_TIMEOUT_MS = 920_000;

type RecordRequest = ReturnType<typeof makeStepRecordRequest>;
type Worker = ReturnType<typeof spawn> & {
  stdout: NonNullable<ReturnType<typeof spawn>["stdout"]>;
  stderr: NonNullable<ReturnType<typeof spawn>["stderr"]>;
  stdin: NonNullable<ReturnType<typeof spawn>["stdin"]>;
};
type WorkerContext = {
  child: Worker;
  request: StepExperimentRequest;
  recordRequest?: RecordRequest;
  resolve: (output: string) => void;
  reject: (error: CliError) => void;
  stdout: string;
  stderr: string;
  outputBytes: number;
  settled: boolean;
  closed: boolean;
  close: Promise<void>;
  resolveClose?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  sigint?: () => void;
  sigterm?: () => void;
  markClosed: () => void;
  markSettled: () => void;
  setHandlers: (handlers: {
    sigint: () => void;
    sigterm: () => void;
    timer: ReturnType<typeof setTimeout>;
  }) => void;
  appendStdout: (chunk: string) => boolean;
  appendStderr: (chunk: string) => void;
};

function validFailureResponse(stdout: string): boolean {
  try {
    const response = stepExperimentResponseSchema.safeParse(JSON.parse(stdout));
    return response.success && response.data.kind === "failed";
  } catch (error) {
    void error;
  }
  return false;
}

function workerErrorCode(stderr: string): string {
  try {
    const last: unknown = JSON.parse(stderr.trim().split("\n").at(-1) ?? "");
    if (
      typeof last === "object" &&
      last !== null &&
      "code" in last &&
      typeof last.code === "string" &&
      ["invalid-input", "payload-too-large", "llm-config-invalid"].includes(
        last.code,
      )
    ) {
      return last.code;
    }
  } catch (error) {
    void error;
  }
  return "step-worker-failed";
}

function closeError(
  code: number | null,
  stdout: string,
  stderr: string,
): CliError | undefined {
  if (code === 0) {
    return undefined;
  }
  if (stdout.trim()) {
    if (validFailureResponse(stdout)) {
      return undefined;
    }
    return new CliError(
      "Local step worker failed without a valid failure response",
      "step-worker-failed",
    );
  }
  return new CliError(
    "Local step worker failed; check input and model configuration",
    workerErrorCode(stderr),
  );
}

function localInput(stepId: string | undefined, flags: Record<string, string>) {
  const parsed = stepExperimentRequestSchema.safeParse({
    stepId,
    input: flags["input-file"]
      ? readRequestJson(flags["input-file"], FILE_BYTES, "Step input")
      : {
          seed: readBoundedText(flags["seed-file"]!, FILE_BYTES, "Step seed"),
          upstream: {},
        },
    ...(flags["system-prompt-file"]
      ? {
          systemPrompt: readBoundedText(
            flags["system-prompt-file"],
            FILE_BYTES,
            "Step system prompt",
          ),
        }
      : {}),
    ...(flags["config-file"]
      ? {
          config: readRequestJson(
            flags["config-file"],
            FILE_BYTES,
            "Step config",
          ),
        }
      : {}),
  });
  if (!parsed.success) {
    throw new CliError(
      "Invalid step experiment input or options",
      "invalid-input",
    );
  }
  return parsed.data;
}

function localOverrides(flags: Record<string, string>) {
  return {
    ...(flags.thinking !== undefined
      ? { thinking: flags.thinking === "on" ? "enabled" : "disabled" }
      : {}),
    ...(flags.temperature !== undefined
      ? { temperature: Number(flags.temperature) }
      : {}),
    ...(flags["top-p"] !== undefined ? { topP: Number(flags["top-p"]) } : {}),
  };
}

function localRequest(
  stepId: string | undefined,
  flags: Record<string, string>,
): StepExperimentRequest {
  if (flags.thinking !== undefined && !["on", "off"].includes(flags.thinking)) {
    throw new CliError("--thinking must be on or off", "invalid-input");
  }
  const fromFile = localInput(stepId, flags);
  const overrides = localOverrides(flags);
  const parsed = stepExperimentRequestSchema.safeParse({
    ...fromFile,
    ...(Object.keys(overrides).length
      ? { config: { ...fromFile.config, ...overrides } }
      : {}),
  });
  if (!parsed.success) {
    throw new CliError(
      "Invalid step experiment input or options",
      "invalid-input",
    );
  }
  return parsed.data;
}

function recordRequest(
  flags: Record<string, string>,
): RecordRequest | undefined {
  if (flags["record-dir"] === undefined) {
    return undefined;
  }
  return makeStepRecordRequest({
    dir: reserveStepRecordDir(flags["record-dir"]),
    inputSource: flags["input-file"] ? "input-file" : "seed-file",
    inputPath: flags["input-file"] ?? flags["seed-file"] ?? null,
    systemPromptPath: flags["system-prompt-file"] ?? null,
    configPath: flags["config-file"] ?? null,
  });
}

async function terminate(context: WorkerContext): Promise<void> {
  if (context.closed) {
    return;
  }
  context.child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (!context.closed) {
      context.child.kill("SIGKILL");
    }
  }, 100);
  try {
    await context.close;
  } finally {
    clearTimeout(escalation);
  }
}

function cleanup(context: WorkerContext): void {
  clearTimeout(context.timer);
  if (context.sigint) {
    process.off("SIGINT", context.sigint);
  }
  if (context.sigterm) {
    process.off("SIGTERM", context.sigterm);
  }
}

function finish(
  context: WorkerContext,
  error?: CliError,
  signal?: NodeJS.Signals,
): void {
  if (context.settled) {
    return;
  }
  context.markSettled();
  cleanup(context);
  if (!error) {
    context.resolve(context.stdout);
    return;
  }
  if (context.recordRequest) {
    markStepRecordUnknown({
      record: context.recordRequest,
      stepId: context.request.stepId,
      input: context.request.input,
      model: context.request.config?.model ?? "unknown",
      code: error.code === "network-error" ? "cli-timeout" : "worker-failed",
    });
  }
  void terminate(context).finally(() => {
    if (signal) {
      process.kill(process.pid, signal);
    }
    context.reject(error);
  });
}

function interrupt(context: WorkerContext, signal: NodeJS.Signals): void {
  finish(
    context,
    new CliError(
      "Step interrupted; the remote provider may still process the request",
      "step-worker-failed",
    ),
    signal,
  );
}

function attachSignals(context: WorkerContext, timeoutMs?: number): void {
  const sigint = () => interrupt(context, "SIGINT");
  const sigterm = () => interrupt(context, "SIGTERM");
  const timer = setTimeout(
    () =>
      finish(
        context,
        new CliError(
          "Step timed out; the remote provider may still process the request",
          "network-error",
        ),
      ),
    timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
  );
  context.setHandlers({ sigint, sigterm, timer });
  process.once("SIGINT", sigint);
  process.once("SIGTERM", sigterm);
}

function attachOutput(context: WorkerContext, payload: string): void {
  const child = context.child;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (!context.appendStdout(chunk)) {
      finish(
        context,
        new CliError("Step response exceeds byte limit", "invalid-response"),
      );
    }
  });
  child.stderr.on("data", (chunk: string) => {
    context.appendStderr(chunk);
  });
  child.on("error", () => {
    finish(
      context,
      new CliError(
        "Unable to start the local server worker",
        "step-worker-failed",
      ),
    );
  });
  child.stdin.on("error", () => {});
  child.on("close", (code) => {
    finish(context, closeError(code, context.stdout, context.stderr));
  });
  child.stdin.end(payload);
}

function attachWorker(
  context: WorkerContext,
  payload: string,
  timeoutMs?: number,
): void {
  const child = context.child;
  child.once("close", () => context.markClosed());
  child.once("error", () => {
    if (child.pid === undefined) {
      context.markClosed();
    }
  });
  attachSignals(context, timeoutMs);
  attachOutput(context, payload);
}

// 为仍在运行的 worker 建立可等待的关闭信号。
function initializeClose(context: WorkerContext): void {
  if (context.closed) {
    return;
  }
  context.close = new Promise<void>((resolveClose) => {
    context.resolveClose = resolveClose;
  });
}

// 集中保存 worker 输出上限、关闭状态和完成回调。
function createWorkerContext(
  child: Worker,
  input: { request: StepExperimentRequest; record?: RecordRequest },
  callbacks: {
    resolve: (output: string) => void;
    reject: (error: CliError) => void;
  },
): WorkerContext {
  const closed = child.exitCode !== null || child.signalCode !== null;
  const context: WorkerContext = {
    child,
    request: input.request,
    recordRequest: input.record,
    resolve: callbacks.resolve,
    reject: callbacks.reject,
    stdout: "",
    stderr: "",
    outputBytes: 0,
    settled: false,
    closed,
    close: Promise.resolve(),
    markClosed() {
      this.closed = true;
      this.resolveClose?.();
    },
    markSettled() {
      this.settled = true;
    },
    setHandlers(handlers) {
      this.sigint = handlers.sigint;
      this.sigterm = handlers.sigterm;
      this.timer = handlers.timer;
    },
    appendStdout(chunk) {
      this.outputBytes += Buffer.byteLength(chunk);
      if (this.outputBytes > RESULT_BYTES) {
        return false;
      }
      this.stdout += chunk;
      return true;
    },
    appendStderr(chunk) {
      this.stderr = (this.stderr + chunk).slice(-65536);
    },
  };
  return context;
}

function executeWorker(
  request: StepExperimentRequest,
  record: RecordRequest | undefined,
  timeoutMs?: number,
): Promise<string> {
  const loader = new URL(
    "../../server/node_modules/tsx/dist/loader.mjs",
    import.meta.url,
  ).href;
  const worker = fileURLToPath(
    new URL("../../server/src/step-lab-main.ts", import.meta.url),
  );
  const payload = JSON.stringify(request);
  if (Buffer.byteLength(payload) > FILE_BYTES) {
    throw new CliError(
      "Combined step experiment request exceeds 1 MiB",
      "payload-too-large",
    );
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", loader, worker], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    // 初始化本次 worker 的独立输出与关闭状态。
    const context = createWorkerContext(
      child,
      { request, record },
      { resolve, reject },
    );
    // 先建立关闭信号，再绑定超时、信号和输出处理。
    initializeClose(context);
    attachWorker(context, payload, timeoutMs);
  });
}

function parseWorkerOutput(output: string, stepId: string | undefined) {
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new CliError("Invalid step worker response", "invalid-response");
  }
  const result = stepExperimentResponseSchema.safeParse(raw);
  if (!result.success || result.data.stepId !== stepId) {
    throw new CliError("Invalid step worker response", "invalid-response");
  }
  if (result.data.kind === "failed") {
    throw new CliError(
      "Step experiment failed; inspect telemetry before retrying",
      result.data.code,
      {
        retryable: result.data.retryable,
        details: result.data,
      },
    );
  }
  return result.data;
}

// 文件只在 CLI 读取。provider 配置与推理只在 server 包的独立 worker 中运行。
export async function runLocalStep(
  stepId: string | undefined,
  flags: Record<string, string>,
  timeoutMs?: number,
) {
  const parsed = localRequest(stepId, flags);
  const record = recordRequest(flags);
  const request = stepExperimentRequestSchema.parse({
    ...parsed,
    ...(record ? { record } : {}),
  });
  const output = await executeWorker(request, record, timeoutMs);
  return parseWorkerOutput(output, stepId);
}
