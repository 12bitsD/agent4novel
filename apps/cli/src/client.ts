import {
  advanceOutcomeDtoSchema,
  httpErrorSchema,
  artifactSchema,
  workSchema,
  workListResponseSchema,
  pipelineStateSchema,
  settingApproveResponseSchema,
  workViewSchema,
  diagnosticResponseSchema,
  diagnosticQuerySchema,
} from "@agent4novel/contracts";
import type {
  BeatSubmission,
  ProseSubmission,
  DiagnosticQuery,
  StartChapterRequest,
  WorkCreateRequest,
  SelectCreativeRequest,
  OutlineDraftRequest,
  ApproveRequest,
  CreativeRegenerateRequest,
  BeatVariantSelectionRequest,
} from "@agent4novel/contracts";
import {
  appConfigSchema,
  matchesStartChapterResponse,
  outlineApprovalRequestSchema,
  outlineApprovalResponseSchema,
  matchesOutlineApprovalResponse,
  type OutlineApprovalRequest,
} from "@agent4novel/contracts";
import {
  agentFileSchema,
  agentFileReadSchema,
  agentFileUploadSchema,
  authorConfigViewSchema,
  authorConfigReceiptSchema,
  authorConfigSaveSchema,
  managedAgentFileText,
  type AuthorConfigSave,
  type AgentFileUpload,
} from "@agent4novel/contracts";
import { createHash } from "node:crypto";
import {
  badExampleRequestSchema,
  badExampleSchema,
  badExamplePageSchema,
  badExampleQuerySchema,
  matchesBadExample,
  type BadExampleRequest,
  type BadExampleQuery,
} from "@agent4novel/contracts";
import type {
  ArtifactKind,
  OutlineDraft,
  SettingApproveRequest,
  ValidationIssue,
  Work,
  WorkSummary,
  WorkView,
  HttpError,
} from "@agent4novel/contracts";

// 普通 REST 请求沿用 300s；advance 可能串行执行多个 LLM step，单独覆盖当前最长两步链：
// 2 * server 900s 上限 + 20s 余量。显式 CLI override 仍统一覆盖两类请求。
export const DEFAULT_CLI_TIMEOUT_MS = 300_000;
export const DEFAULT_ADVANCE_TIMEOUT_MS = 1_820_000;
const MIN_CLI_TIMEOUT_MS = 1_000;
const MAX_CLI_TIMEOUT_MS = 3_600_000;

type CliErrorOptions = {
  status?: number;
  retryable?: boolean;
  attemptId?: string;
  issues?: ValidationIssue[];
  details?: Record<string, unknown>;
};

export class CliError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly attemptId?: string;
  readonly issues?: ValidationIssue[];
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    readonly code: string,
    readonly options: CliErrorOptions = {},
  ) {
    super(message);
    this.name = "CliError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.attemptId = options.attemptId;
    this.issues = options.issues;
    this.details = options.details;
  }
}

export function validationIssueDetails(
  error: HttpError,
): Record<string, unknown> | undefined {
  if (error.issueCount === undefined && error.issuesTruncated === undefined) {
    return undefined;
  }
  return {
    ...(error.issueCount !== undefined ? { issueCount: error.issueCount } : {}),
    ...(error.issuesTruncated !== undefined
      ? { issuesTruncated: error.issuesTruncated }
      : {}),
  };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Client = ReturnType<typeof createClient>;

export function parseCliTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (
    raw.trim() === "" ||
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_CLI_TIMEOUT_MS ||
    parsed > MAX_CLI_TIMEOUT_MS
  ) {
    throw new CliError(
      "CLI timeout must be an integer between 1000 and 3600000 milliseconds",
      "usage",
    );
  }
  return parsed;
}

type CallOptions = {
  defaultTimeoutMs?: number;
  raw?: boolean;
  matchesError?: (error: HttpError) => boolean;
};
type RequestOptions = CallOptions & {
  method: string;
  path: string;
  body?: unknown;
};
type ClientContext = {
  baseUrl: string;
  fetchImpl: FetchLike;
  timeoutOverrideMs?: number;
};
type Call = <T>(
  method: string,
  path: string,
  body?: unknown,
  options?: CallOptions,
) => Promise<T>;
type RequestKind = "read" | "write";

function invalidResponse(outcome: RequestKind): CliError {
  return new CliError(
    "Invalid server response; inspect the work before retrying a write",
    "invalid-response",
    {
      details: outcome === "write" ? { writeOutcome: "unknown" } : undefined,
    },
  );
}

function validate<T>(
  schema: {
    safeParse: (
      data: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  data: unknown,
  matches: (result: T) => boolean = () => true,
  outcome: RequestKind = "read",
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success || !matches(parsed.data)) {
    throw invalidResponse(outcome);
  }
  return parsed.data;
}

function commandTargetMismatch(error: HttpError, path: string): boolean {
  if (!("command" in error) || error.command.kind !== "execution-result") {
    return false;
  }
  const requestedWork = /^\/api\/works\/([^/?]+)/.exec(path)?.[1];
  return (
    requestedWork !== undefined &&
    error.command.target.workId !== decodeURIComponent(requestedWork)
  );
}

function responseError(
  options: RequestOptions,
  response: Response,
  data: unknown,
): CliError {
  const parsed = httpErrorSchema.safeParse(data);
  const outcome = options.method === "GET" ? "read" : "write";
  if (!parsed.success || !(options.matchesError?.(parsed.data) ?? true)) {
    return invalidResponse(outcome);
  }
  const error = parsed.data;
  if (commandTargetMismatch(error, options.path)) {
    return invalidResponse(outcome);
  }
  const unknownWrite =
    "command" in error && error.command.writeOutcome === "unknown";
  const issueDetails = validationIssueDetails(error);
  return new CliError(error.message, error.code, {
    status: unknownWrite ? undefined : response.status,
    retryable: error.retryable,
    attemptId: error.attemptId,
    issues: error.issues,
    details:
      "command" in error
        ? {
            ...issueDetails,
            command: error.command,
            telemetry: error.telemetry,
            writeOutcome: error.command.writeOutcome,
          }
        : issueDetails,
  });
}

async function performRequest<T>(
  context: ClientContext,
  options: RequestOptions,
): Promise<T> {
  const response = await context.fetchImpl(
    `${context.baseUrl}${options.path}`,
    {
      method: options.method,
      headers:
        options.body === undefined
          ? undefined
          : { "content-type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  const data: unknown = await response.json().catch(() => null);
  if (options.raw) {
    return { status: response.status, body: data } as T;
  }
  if (!response.ok) {
    throw responseError(options, response, data);
  }
  return data as T;
}

async function request<T>(
  context: ClientContext,
  options: RequestOptions,
): Promise<T> {
  const controller = new AbortController();
  const originalFetch = context.fetchImpl;
  const requestContext = {
    ...context,
    fetchImpl: ((url: string, init?: RequestInit) =>
      originalFetch(url, { ...init, signal: controller.signal })) as FetchLike,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(
          new CliError(
            "Request timed out; a submitted write may still complete on the server",
            "network-error",
          ),
        );
      },
      context.timeoutOverrideMs ??
        options.defaultTimeoutMs ??
        DEFAULT_CLI_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      performRequest<T>(requestContext, options),
      deadline,
    ]);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      "Request could not be completed; a submitted write may still complete on the server",
      "network-error",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function configWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof CliError &&
      (error.status === undefined || error.status >= 500)
    ) {
      throw new CliError(error.message, error.code, {
        retryable: error.retryable,
        attemptId: error.attemptId,
        issues: error.issues,
        details: { ...error.details, writeOutcome: "unknown" },
      });
    }
    throw error;
  }
}

function badExampleWriteMethods(call: Call) {
  return {
    markBadExample: async (workId: string, input: BadExampleRequest) => {
      const parsed = badExampleRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new CliError("Invalid bad-example request", "invalid-input");
      }
      return validate(
        badExampleSchema,
        await configWrite(() =>
          call<unknown>(
            "POST",
            `/api/works/${encodeURIComponent(workId)}/bad-examples`,
            parsed.data,
            { defaultTimeoutMs: 30_000 },
          ),
        ),
        (result) => matchesBadExample(result, workId, parsed.data),
        "write",
      );
    },
  };
}

function badExampleReadMethods(call: Call) {
  return {
    getBadExample: async (workId: string, id: string) =>
      validate(
        badExampleSchema,
        await call<unknown>(
          "GET",
          `/api/works/${encodeURIComponent(workId)}/bad-examples/${encodeURIComponent(id)}`,
        ),
        (result) => result.workId === workId && result.id === id,
      ),
    listBadExamples: async (workId: string, input: BadExampleQuery = {}) => {
      const parsed = badExampleQuerySchema.safeParse(input);
      if (!parsed.success) {
        throw new CliError("Invalid bad-example query", "invalid-input");
      }
      const query = parsed.data;
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]): [string, string] => [key, String(value)]),
      );
      return validate(
        badExamplePageSchema,
        await call<unknown>(
          "GET",
          `/api/works/${encodeURIComponent(workId)}/bad-examples${params.size ? `?${params}` : ""}`,
        ),
        (result) =>
          result.workId === workId &&
          result.chapter === query.chapter &&
          result.after === query.after,
      );
    },
  };
}

function authorConfigMethods(call: Call) {
  return {
    getAuthorConfig: async (workId: string) =>
      validate(
        authorConfigViewSchema,
        await call<unknown>(
          "GET",
          `/api/works/${encodeURIComponent(workId)}/agent-config`,
        ),
        (view) => view.workId === workId,
      ),
    saveAuthorConfig: async (workId: string, input: AuthorConfigSave) => {
      const parsed = authorConfigSaveSchema.safeParse(input);
      if (!parsed.success) {
        throw new CliError(
          "Invalid author configuration request",
          "invalid-input",
        );
      }
      const request = parsed.data;
      return validate(
        authorConfigReceiptSchema,
        await configWrite(() =>
          call<unknown>(
            "PUT",
            `/api/works/${encodeURIComponent(workId)}/agent-config`,
            request,
            { defaultTimeoutMs: 30_000 },
          ),
        ),
        (result) =>
          result.workId === workId &&
          result.requestId === request.requestId &&
          result.revision === request.expectedRevision + 1 &&
          JSON.stringify(result.document) === JSON.stringify(request.document),
        "write",
      );
    },
  };
}

function agentFileMethods(call: Call) {
  return {
    uploadAgentFile: async (workId: string, input: AgentFileUpload) => {
      const parsed = agentFileUploadSchema.safeParse(input);
      if (!parsed.success) {
        throw new CliError("Invalid agent file request", "invalid-input");
      }
      const text = managedAgentFileText(input.kind, input.text);
      return validate(
        agentFileSchema,
        await configWrite(() =>
          call<unknown>(
            "POST",
            `/api/works/${encodeURIComponent(workId)}/agent-files`,
            parsed.data,
            { defaultTimeoutMs: 30_000 },
          ),
        ),
        (result) =>
          result.workId === workId &&
          result.id === input.requestId &&
          result.kind === input.kind &&
          result.byteLength === Buffer.byteLength(text) &&
          result.sha256 === createHash("sha256").update(text).digest("hex"),
        "write",
      );
    },
    getAgentFile: async (workId: string, fileId: string) =>
      validate(
        agentFileReadSchema,
        await call<unknown>(
          "GET",
          `/api/works/${encodeURIComponent(workId)}/agent-files/${encodeURIComponent(fileId)}`,
        ),
        (result) =>
          result.file.workId === workId &&
          result.file.id === fileId &&
          result.file.byteLength === Buffer.byteLength(result.text) &&
          result.file.sha256 ===
            createHash("sha256").update(result.text).digest("hex"),
      ),
  };
}

function workMethods(call: Call) {
  return {
    getConfig: async () =>
      validate(appConfigSchema, await call<unknown>("GET", "/api/config")),
    listWorks: async (): Promise<WorkSummary[]> =>
      validate(
        workListResponseSchema,
        await call<unknown>("GET", "/api/works"),
      ),
    createWork: async (input: WorkCreateRequest): Promise<Work> =>
      validate(
        workSchema,
        await call<unknown>("POST", "/api/works", input),
        (result) => result.seed === input.seed,
        "write",
      ),
    getWork: async (workId: string, reconcile = false): Promise<WorkView> => {
      const data = await call<unknown>(
        "GET",
        `/api/works/${encodeURIComponent(workId)}`,
        undefined,
        { defaultTimeoutMs: reconcile ? 10_000 : DEFAULT_CLI_TIMEOUT_MS },
      );
      return validate(workViewSchema, data, (result) => result.id === workId);
    },
  };
}

function advanceMethods(call: Call) {
  return {
    advance: async (workId: string) => {
      const data = await call<unknown>(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/advance`,
        undefined,
        { defaultTimeoutMs: DEFAULT_ADVANCE_TIMEOUT_MS },
      );
      return validate(
        advanceOutcomeDtoSchema,
        data,
        (result) => result.state.workId === workId,
        "write",
      );
    },
    startChapter: async (workId: string, request: StartChapterRequest) => {
      const data = await call<unknown>(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/chapters/start`,
        request,
        {
          defaultTimeoutMs: 920_000,
          matchesError: (error) =>
            matchesStartChapterResponse(error, workId, request.chapter),
        },
      );
      return validate(
        advanceOutcomeDtoSchema,
        data,
        (result) =>
          matchesStartChapterResponse(result, workId, request.chapter),
        "write",
      );
    },
  };
}

function creativeMethods(call: Call) {
  return {
    select: async (
      workId: string,
      directionId: string,
      expectedHeadVersion: number,
    ) =>
      validate(
        artifactSchema,
        await call<unknown>(
          "POST",
          `/api/works/${encodeURIComponent(workId)}/artifacts/creative/select`,
          { directionId, expectedHeadVersion } satisfies SelectCreativeRequest,
        ),
        (result) =>
          result.workId === workId &&
          result.kind === "creative" &&
          result.chapter === undefined &&
          result.humanStatus === "approved",
        "write",
      ),
    creativeRegenerate: (
      workId: string,
      request: CreativeRegenerateRequest,
    ) => {
      const path =
        `/api/works/${encodeURIComponent(workId)}` +
        "/artifacts/creative/regenerate";
      return call<{ status: number; body: unknown }>(
        "POST",
        path,
        request,
        { defaultTimeoutMs: 920_000, raw: true },
      );
    },
  };
}

async function approveOutlineCall(
  call: Call,
  workId: string,
  request: OutlineApprovalRequest,
) {
  const parsed = outlineApprovalRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new CliError("Invalid outline approval request", "invalid-input");
  }
  const candidate = await configWrite(() =>
    call<unknown>(
      "POST",
      `/api/works/${encodeURIComponent(workId)}/artifacts/outline/approve`,
      parsed.data,
      {
        defaultTimeoutMs: 30_000,
        matchesError: (error) => !("command" in error),
      },
    ),
  );
  return validate(
    outlineApprovalResponseSchema,
    candidate,
    (result) => matchesOutlineApprovalResponse(workId, parsed.data, result),
    "write",
  );
}

function outlineMethods(call: Call) {
  return {
    saveOutline: async (
      workId: string,
      content: OutlineDraft,
      expectedHeadVersion: number,
    ) =>
      validate(
        artifactSchema,
        await call<unknown>(
          "PUT",
          `/api/works/${encodeURIComponent(workId)}/artifacts/outline`,
          { content, expectedHeadVersion } satisfies OutlineDraftRequest,
        ),
        (result) =>
          result.workId === workId &&
          result.kind === "outline" &&
          result.chapter === undefined &&
          result.humanStatus === "pending",
        "write",
      ),
    approve: async (workId: string, kind: ArtifactKind) =>
      validate(
        pipelineStateSchema,
        await call<unknown>(
          "POST",
          `/api/works/${encodeURIComponent(workId)}/approve`,
          { kind } satisfies ApproveRequest,
        ),
        (result) => result.workId === workId,
        "write",
      ),
    approveOutline: (workId: string, request: OutlineApprovalRequest) =>
      approveOutlineCall(call, workId, request),
  };
}

function diagnosticMethods(call: Call) {
  return {
    approveSetting: async (workId: string, request: SettingApproveRequest) => {
      const data = await call<unknown>(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/artifacts/setting/approve`,
        request,
      );
      return validate(
        settingApproveResponseSchema,
        data,
        (result) => result.workId === workId,
        "write",
      );
    },
    getTelemetry: async (workId: string, query: DiagnosticQuery = {}) => {
      const params = new URLSearchParams();
      const diagnostic = diagnosticQuerySchema.parse(query);
      for (const [key, value] of Object.entries(diagnostic)) {
        if (value !== undefined) {
          params.set(key, value);
        }
      }
      const result = validate(
        diagnosticResponseSchema,
        await call<unknown>(
          "GET",
          `/api/works/${encodeURIComponent(workId)}/telemetry${params.size ? `?${params}` : ""}`,
        ),
      );
      if (result.workId !== workId) {
        throw new CliError(
          "Diagnostic response belongs to a different work",
          "invalid-response",
        );
      }
      return result;
    },
  };
}

function prosePath(submission: ProseSubmission): string {
  if (submission.operation === "approve-prose") {
    return "approve";
  }
  if (submission.operation === "save-prose") {
    return "save";
  }
  return "regenerate";
}

function chapterCommandMethods(call: Call) {
  return {
    beatCommand: (workId: string, submission: BeatSubmission) =>
      call<{ status: number; body: unknown }>(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/artifacts/beat/${submission.operation === "approve-beat" ? "approve" : "regenerate"}`,
        submission.request,
        {
          defaultTimeoutMs:
            submission.operation === "approve-beat" ? 30_000 : 920_000,
          raw: true,
        },
      ),
    selectBeatVariant: (workId: string, request: BeatVariantSelectionRequest) =>
      call<{ status: number; body: unknown }>(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/artifacts/beat/select`,
        request,
        { defaultTimeoutMs: 30_000, raw: true },
      ),
    proseCommand: (workId: string, submission: ProseSubmission) =>
      call<{ status: number; body: unknown }>(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/artifacts/prose/${prosePath(submission)}`,
        submission.request,
        {
          defaultTimeoutMs:
            submission.operation === "regenerate-prose" ? 920_000 : 30_000,
          raw: true,
        },
      ),
  };
}

export function createClient(opts: {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}) {
  const context: ClientContext = {
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    fetchImpl: opts.fetch ?? fetch,
    timeoutOverrideMs:
      opts.timeoutMs === undefined
        ? undefined
        : parseCliTimeoutMs(String(opts.timeoutMs)),
  };
  const call: Call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options: CallOptions = {},
  ): Promise<T> => request<T>(context, { method, path, body, ...options });
  return {
    ...badExampleWriteMethods(call),
    ...badExampleReadMethods(call),
    ...authorConfigMethods(call),
    ...agentFileMethods(call),
    ...workMethods(call),
    ...advanceMethods(call),
    ...creativeMethods(call),
    ...outlineMethods(call),
    ...diagnosticMethods(call),
    ...chapterCommandMethods(call),
  };
}
