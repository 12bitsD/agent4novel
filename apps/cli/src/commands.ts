import { isDeepStrictEqual } from "node:util";
import type {
  ArtifactKind,
  CreativeContent,
  OutlineDraft,
  WorkView,
  CreativeRegenerateRequest,
} from "@agent4novel/contracts";
import {
  artifactSchema,
  creativeRegenerateRequestSchema,
  httpErrorSchema,
  matchesSettingSubmission,
  settingApproveRequestSchema,
  settingApproveResponseSchema,
  settingArtifactSchema,
  startChapterRequestSchema,
  outlineApprovalRequestSchema,
  perChapterKinds,
  beatApproveRequestSchema,
  beatRegenerateRequestSchema,
  beatArtifactSchema,
  recoverBeatSubmission,
  beatCommandErrorSchema,
  beatCommandResponseSchema,
  beatVariantSelectionRequestSchema,
  beatVariantSelectionResponseSchema,
  matchesBeatSubmission,
  proseApproveRequestSchema,
  proseRegenerateRequestSchema,
  proseSaveRequestSchema,
  proseArtifactSchema,
  recoverProseSubmission,
  proseCommandErrorSchema,
  proseCommandResponseSchema,
  matchesProseSubmission,
} from "@agent4novel/contracts";
import { CliError, validationIssueDetails } from "./client.js";
import type { Client } from "./client.js";
import type {
  BeatSubmission,
  ProseSubmission,
  DiagnosticQuery,
  BeatVariantSelectionRequest,
  BeatVariantSelectionResponse,
} from "@agent4novel/contracts";

// 命令层(#14):每个命令返回可 JSON 序列化的结果,由 main 打印;进度一律走 stderr(logger 注入)

export type Logger = (line: string) => void;

export async function list(client: Client) {
  return client.listWorks();
}

export async function create(
  client: Client,
  args: { seed: string; title?: string },
) {
  return client.createWork(args);
}

// --kind 时只取该产物(快照里每个 kind 只有 head 版本)
export async function get(
  client: Client,
  workId: string,
  kind?: ArtifactKind,
  chapter?: number,
) {
  if (
    (!kind && chapter !== undefined) ||
    (kind && perChapterKinds.includes(kind) !== (chapter !== undefined)) ||
    (chapter !== undefined && (!Number.isSafeInteger(chapter) || chapter <= 0))
  ) {
    throw new CliError(
      "Chapter artifacts require --chapter; work artifacts forbid it",
      "usage",
    );
  }
  const work = await client.getWork(workId);
  if (!kind) {
    return work;
  }
  const artifact = work.artifacts.find(
    (a) => a.kind === kind && a.chapter === chapter,
  );
  if (!artifact) {
    throw new CliError(`no ${kind} artifact`, "artifact-not-found", {
      status: 404,
    });
  }
  return artifact;
}

export async function advance(client: Client, workId: string) {
  return client.advance(workId);
}

export async function startChapter(
  client: Client,
  workId: string,
  input: unknown,
) {
  const request = startChapterRequestSchema.safeParse(input);
  if (!request.success) {
    throw new CliError(
      "Invalid chapter start request; expected target chapter and previous Prose identity/version",
      "invalid-input",
    );
  }
  // Never replace the file's baseline or replay a possibly committed
  // generation.
  return client.startChapter(workId, request.data);
}

function headOf(work: WorkView, kind: ArtifactKind): number {
  const head = work.artifacts.find((a) => a.kind === kind)?.version;
  if (head === undefined) {
    throw new CliError(`no ${kind} artifact`, "artifact-not-found", {
      status: 404,
    });
  }
  return head;
}

// select/save-outline 自动回填 expectedHeadVersion:一次快照同时供方向解析与乐观锁,Agent 不用自己记账
// directionId 缺省取第一个方向(smoke 场景);交互场景应显式传
export async function select(
  client: Client,
  workId: string,
  directionId?: string,
) {
  const work = await client.getWork(workId);
  let dir = directionId;
  if (!dir) {
    const creative = work.artifacts.find((a) => a.kind === "creative");
    const first =
      creative && (creative.content as CreativeContent).directions[0];
    if (!first) {
      throw new CliError("no direction to select", "direction-not-selected", {
        status: 409,
      });
    }
    dir = first.directionId;
  }
  return client.select(workId, dir, headOf(work, "creative"));
}

// 创意再生的请求文件就是冻结基线；此命令只 POST 一次，不先 GET、自动重发或追认响应未知。
function creativeTransportError(error: unknown): CliError {
  if (error instanceof CliError) {
    return new CliError(error.message, error.code, {
      status: error.status,
      retryable: error.retryable,
      attemptId: error.attemptId,
      issues: error.issues,
      details: { ...error.details, writeOutcome: "unknown" },
    });
  }
  return new CliError(
    "Creative regeneration result is unknown; keep the request file and inspect the work",
    "creative-result-unknown",
    { details: { writeOutcome: "unknown" } },
  );
}

function creativeArtifact(
  response: { status: number; body: unknown },
  workId: string,
  request: CreativeRegenerateRequest,
) {
  const artifact = artifactSchema.safeParse(response.body);
  const expectedVersion = (request.expectedHeadVersion ?? 0) + 1;
  if (
    !artifact.success ||
    artifact.data.workId !== workId ||
    artifact.data.kind !== "creative" ||
    artifact.data.chapter !== undefined ||
    artifact.data.humanStatus !== "pending" ||
    artifact.data.version !== expectedVersion ||
    (request.expectedArtifactId !== null &&
      artifact.data.id === request.expectedArtifactId)
  ) {
    throw new CliError(
      "Creative regeneration response is invalid; keep the request file and inspect the work",
      "invalid-response",
      { details: { writeOutcome: "unknown" } },
    );
  }
  return artifact.data;
}

function creativeHttpError(response: {
  status: number;
  body: unknown;
}): CliError {
  const error = httpErrorSchema.safeParse(response.body);
  if (!error.success) {
    return new CliError(
      "Creative regeneration response is invalid; keep the request file and inspect the work",
      "invalid-response",
      { details: { writeOutcome: "unknown" } },
    );
  }
  if (response.status >= 500) {
    return new CliError(
      "Creative regeneration result is unknown; keep the request file and inspect the work",
      "creative-result-unknown",
      {
        details: {
          ...validationIssueDetails(error.data),
          writeOutcome: "unknown",
        },
      },
    );
  }
  return new CliError(error.data.message, error.data.code, {
    status: response.status,
    retryable: error.data.retryable,
    attemptId: error.data.attemptId,
    issues: error.data.issues,
    details: validationIssueDetails(error.data),
  });
}

// 创意再生的请求文件就是冻结基线；此命令只 POST 一次，不先 GET、自动重发或追认响应未知。
export async function regenerateCreative(
  client: Client,
  workId: string,
  input: unknown,
) {
  const parsed = creativeRegenerateRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new CliError(
      "Invalid creative regeneration request file",
      "invalid-input",
      {
        issues: parsed.error.issues.map(({ path, code }) => ({
          path,
          code,
          message: "invalid field",
        })),
      },
    );
  }
  const request: CreativeRegenerateRequest = parsed.data;
  let response: { status: number; body: unknown };
  try {
    response = await client.creativeRegenerate(workId, request);
  } catch (error) {
    throw creativeTransportError(error);
  }
  if (response.status >= 200 && response.status < 300) {
    return creativeArtifact(response, workId, request);
  }
  throw creativeHttpError(response);
}

export async function saveOutline(
  client: Client,
  workId: string,
  content: OutlineDraft,
) {
  const work = await client.getWork(workId);
  return client.saveOutline(workId, content, headOf(work, "outline"));
}

export async function approve(
  client: Client,
  workId: string,
  kind: ArtifactKind,
) {
  if (kind === "prose") {
    throw new CliError(
      "Use approve-prose with a complete request file",
      "prose-approval-required",
    );
  }
  if (kind === "beat") {
    throw new CliError(
      "Use approve-beat with a complete request file",
      "beat-approval-required",
    );
  }
  if (kind === "setting") {
    throw new CliError(
      "Use approve-setting <workId> --file <request.json> to submit edited content and expectedHeadVersion",
      "setting-approval-required",
    );
  }
  return client.approve(workId, kind);
}

export async function approveOutline(
  client: Client,
  workId: string,
  input: unknown,
) {
  const request = outlineApprovalRequestSchema.safeParse(input);
  if (!request.success) {
    throw new CliError(
      "Invalid outline approval request; expectedArtifactId and expectedHeadVersion are required",
      "invalid-input",
    );
  }
  // The file owns the baseline. No GET/refill, automatic confirmation or
  // duplicate POST.
  return client.approveOutline(workId, request.data);
}

function settingBaseline(
  work: WorkView,
  request: ReturnType<typeof settingApproveRequestSchema.parse>,
) {
  const baseline = settingArtifactSchema.safeParse(
    work.artifacts.find((artifact) => artifact.kind === "setting"),
  );
  if (!baseline.success) {
    throw new CliError("No setting artifact", "artifact-not-found", {
      status: 404,
    });
  }
  if (baseline.data.humanStatus === "approved") {
    throw new CliError(
      "Setting is already approved; use get --kind setting to inspect it. This invocation cannot confirm an earlier submission",
      "artifact-already-approved",
      { status: 409 },
    );
  }
  if (baseline.data.version !== request.expectedHeadVersion) {
    throw new CliError(
      "The request file version does not match the current setting; it was not replaced or submitted",
      "version-conflict",
      { status: 409 },
    );
  }
  return baseline.data;
}

function rejectedSetting(error?: CliError): boolean {
  return (
    error?.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.code !== "invalid-response"
  );
}

async function reconcileSetting(
  client: Client,
  workId: string,
  context: {
    baseline: ReturnType<typeof settingArtifactSchema.parse>;
    request: ReturnType<typeof settingApproveRequestSchema.parse>;
    failure: unknown;
  },
) {
  let error: CliError | undefined;
  if (context.failure instanceof CliError) {
    error = context.failure;
  }
  const rejected = rejectedSetting(error);
  if (rejected && error?.status !== 409) {
    throw context.failure;
  }
  const latest = await client.getWork(workId).catch(() => undefined);
  const candidate = settingApproveResponseSchema.safeParse(
    latest?.artifacts.find((artifact) => artifact.kind === "setting"),
  );
  if (candidate.success) {
    if (
      matchesSettingSubmission(
        context.baseline,
        context.request,
        candidate.data,
      )
    ) {
      return candidate.data;
    }
    throw new CliError(
      "Setting was approved with different content; keep the request file and read the current setting",
      "setting-conflict",
      { status: 409 },
    );
  }
  if (rejected) {
    throw context.failure;
  }
  throw new CliError(
    "Setting approval result is unknown; keep the request file and inspect the current setting before continuing",
    "setting-result-unknown",
  );
}

export async function approveSetting(
  client: Client,
  workId: string,
  input: unknown,
) {
  const request = settingApproveRequestSchema.safeParse(input);
  if (!request.success) {
    throw new CliError(
      "Invalid setting approval request; expected content and expectedHeadVersion",
      "invalid-input",
    );
  }
  const work = await client.getWork(workId);
  const baseline = settingBaseline(work, request.data);
  let failure: unknown;
  try {
    const candidate = await client.approveSetting(workId, request.data);
    if (!matchesSettingSubmission(baseline, request.data, candidate)) {
      throw new CliError(
        "Setting response does not match this submission",
        "invalid-response",
        { status: 200 },
      );
    }
    return candidate;
  } catch (error) {
    failure = error;
  }
  return reconcileSetting(client, workId, {
    baseline,
    request: request.data,
    failure,
  });
}

// LLM 遥测回看(#14):advance 响应里已内联本次的;这个命令用于事后/跨次分析
export async function logs(
  client: Client,
  workId: string,
  query: DiagnosticQuery = {},
) {
  return client.getTelemetry(workId, query);
}

function beatConflictError(
  baseline: ReturnType<typeof beatArtifactSchema.parse>,
  local: Record<string, unknown>,
): CliError {
  return new CliError(
    "Request baseline is no longer pending; the file was not modified or submitted",
    "version-conflict",
    {
      status: 409,
      details: {
        ...local,
        resolution: "conflict",
        nextActions: ["read-work", "load-server-version"],
        observedHead: {
          artifactId: baseline.id,
          version: baseline.version,
          humanStatus: baseline.humanStatus,
        },
      },
    },
  );
}

function beatBaseline(
  work: WorkView,
  submission: BeatSubmission,
  local: Record<string, unknown>,
) {
  const baseline = beatArtifactSchema.safeParse(
    work.artifacts.find(
      (artifact) =>
        artifact.kind === "beat" &&
        artifact.chapter === submission.request.chapter,
    ),
  );
  if (!baseline.success) {
    throw new CliError(
      "No Beat for the requested chapter",
      "artifact-not-found",
      {
        status: 404,
        details: {
          ...local,
          resolution: "rejected",
          nextActions: ["read-work"],
          observedHead: null,
        },
      },
    );
  }
  if (
    baseline.data.id !== submission.request.expectedArtifactId ||
    baseline.data.version !== submission.request.expectedHeadVersion ||
    baseline.data.humanStatus !== "pending"
  ) {
    throw beatConflictError(baseline.data, local);
  }
  return baseline.data;
}

type CommandFailure =
  | ReturnType<typeof beatCommandErrorSchema.safeParse>
  | ReturnType<typeof proseCommandErrorSchema.safeParse>;
type CommandResponse = { status: number; body: unknown } | undefined;

// 将未确认命令统一转换为冲突、未知或原始错误。
function commandResultError<
  Failure extends CommandFailure,
  Recovery extends { resolution: string; artifact?: unknown },
>(input: {
  message: string;
  conflictCode: string;
  unknownCode: string;
  local: Record<string, unknown>;
  recovery: Recovery;
  response: CommandResponse;
  failure: Failure;
  causeCode: string;
}): CliError {
  let code = input.causeCode;
  if (input.recovery.resolution === "conflict") {
    code = input.conflictCode;
  } else if (input.recovery.resolution === "uncertain") {
    code = input.unknownCode;
  }
  const { artifact: _artifact, ...safeRecovery } = input.recovery;
  return new CliError(input.message, code, {
    status: input.response?.status,
    retryable: input.failure.success ? input.failure.data.retryable : false,
    attemptId: input.failure.success
      ? input.failure.data.attemptId
      : undefined,
    issues: input.failure.success ? input.failure.data.issues : undefined,
    details: {
      ...input.local,
      ...safeRecovery,
      causeCode: input.causeCode,
      ...(input.failure.success
        ? {
            ...validationIssueDetails(input.failure.data),
            command: input.failure.data.command,
            telemetry: input.failure.data.telemetry,
            inputBudget: input.failure.data.inputBudget,
          }
        : {}),
    },
  });
}

// 强制 read-work 对账并修正错误码，绝不自动重试写请求。
async function readbackCommand<Failure extends CommandFailure>(
  client: Client,
  workId: string,
  input: {
    response: CommandResponse;
    causeCode: string;
    failure: Failure;
  },
) {
  let code = input.causeCode;
  if (input.failure.success) {
    code = input.failure.data.code;
  } else if (input.response) {
    code = "invalid-response";
  }
  let latest: WorkView | undefined;
  try {
    latest = await client.getWork(workId, true);
  } catch (error) {
    if (error instanceof CliError && error.code === "work-not-found") {
      code = "work-not-found";
    }
  }
  return { failure: input.failure, latest, causeCode: code };
}

function beatResultError(
  context: {
    submission: BeatSubmission;
    local: Record<string, unknown>;
    recovery: ReturnType<typeof recoverBeatSubmission>;
  },
  response: { status: number; body: unknown } | undefined,
  readback: {
    failure: ReturnType<typeof beatCommandErrorSchema.safeParse>;
    causeCode: string;
  },
): CliError {
  // 使用 Beat 专属错误码组装未确认结果。
  return commandResultError({
    message:
      "Beat command did not confirm the requested result; " +
      "keep the request file",
    conflictCode: "beat-result-conflict",
    unknownCode: "beat-result-unknown",
    local: context.local,
    recovery: context.recovery,
    response,
    failure: readback.failure,
    causeCode: readback.causeCode,
  });
}

async function readbackBeat(
  client: Client,
  workId: string,
  response: { status: number; body: unknown } | undefined,
  causeCode: string,
) {
  const failure = beatCommandErrorSchema.safeParse(response?.body);
  // 用 Beat 错误 schema 对账最新作品。
  return readbackCommand(client, workId, { response, causeCode, failure });
}

async function recoverBeatCommand(
  client: Client,
  context: {
    workId: string;
    submission: BeatSubmission;
    baseline: ReturnType<typeof beatArtifactSchema.parse>;
    local: Record<string, unknown>;
    recovery: ReturnType<typeof recoverBeatSubmission>;
  },
  response: { status: number; body: unknown } | undefined,
  causeCode: string,
) {
  const { failure, latest, causeCode: readbackCode } = await readbackBeat(
    client,
    context.workId,
    response,
    causeCode,
  );
  const recovered = recoverBeatSubmission({
    baseline: context.baseline,
    submission: context.submission,
    hasUnknownWrite: context.recovery.hasUnknownWrite,
    response,
    work: latest,
    workIsReadback: latest !== undefined,
  });
  if (recovered.resolution === "confirmed") {
    return {
      artifact: recovered.artifact,
      resolution: recovered.resolution,
      nextActions: recovered.nextActions,
      confirmedBy: "read-work",
    };
  }
  throw beatResultError(
    {
      submission: context.submission,
      local: context.local,
      recovery: recovered,
    },
    response,
    {
      failure,
      causeCode: readbackCode,
    },
  );
}

function makeBeatSubmission(
  operation: BeatSubmission["operation"],
  data: unknown,
): BeatSubmission {
  if (operation === "approve-beat") {
    return { operation, request: beatApproveRequestSchema.parse(data) };
  }
  return { operation, request: beatRegenerateRequestSchema.parse(data) };
}

function beatLocal(workId: string, submission: BeatSubmission) {
  return {
    operation: submission.operation,
    target: { workId, kind: "beat", chapter: submission.request.chapter },
    expectedHead: {
      artifactId: submission.request.expectedArtifactId,
      version: submission.request.expectedHeadVersion,
    },
  };
}

function beatSubmissionInput(
  operation: BeatSubmission["operation"],
  input: unknown,
): BeatSubmission {
  const schema =
    operation === "approve-beat"
      ? beatApproveRequestSchema
      : beatRegenerateRequestSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CliError("Invalid Beat request file", "invalid-input", {
      issues: parsed.error.issues.map(({ path, code }) => ({
        path,
        code,
        message: "invalid field",
      })),
    });
  }
  return makeBeatSubmission(operation, parsed.data);
}

export async function runBeatCommand(
  client: Client,
  workId: string,
  operation: BeatSubmission["operation"],
  input: unknown,
) {
  const submission = beatSubmissionInput(operation, input);
  const local = beatLocal(workId, submission);
  const work = await client.getWork(workId);
  const baseline = beatBaseline(work, submission, local);
  let response: { status: number; body: unknown } | undefined;
  let causeCode = "network-error";
  try {
    response = await client.beatCommand(workId, submission);
  } catch (error) {
    if (error instanceof CliError) {
      causeCode = error.code;
    }
  }
  const recovery = recoverBeatSubmission({
    baseline,
    submission,
    hasUnknownWrite: false,
    response,
  });
  if (recovery.resolution === "confirmed") {
    return beatCommandResponseSchema.parse(response!.body);
  }
  return recoverBeatCommand(
    client,
    { workId, submission, baseline, local, recovery },
    response,
    causeCode,
  );
}

function oldVariantArtifactMatches(
  workId: string,
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  const artifact = value.artifact;
  const original = value.comparison.original;
  const candidate = value.comparison.candidate;
  return (
    artifact.workId === workId &&
    artifact.kind === "beat" &&
    artifact.chapter === request.chapter &&
    artifact.id !== original.id &&
    artifact.id !== candidate.id &&
    artifact.version === candidate.version + 1 &&
    artifact.humanStatus === "pending" &&
    isDeepStrictEqual(artifact.content, original.content)
  );
}

function variantResultMatches(
  workId: string,
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  if (request.choice === "new") {
    return (
      value.selection.writeOutcome === "not-committed" &&
      isDeepStrictEqual(value.artifact, value.comparison.candidate)
    );
  }
  return (
    value.selection.writeOutcome === "committed" &&
    oldVariantArtifactMatches(workId, request, value)
  );
}

function variantCandidateMatches(
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  const candidate = value.comparison.candidate;
  return (
    candidate.id === request.expectedArtifactId &&
    candidate.version === request.expectedHeadVersion &&
    candidate.humanStatus === "pending" &&
    value.comparison.original.id !== candidate.id &&
    candidate.version === value.comparison.original.version + 1
  );
}

function variantOriginalMatches(
  workId: string,
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  const original = value.comparison.original;
  return (
    original.workId === workId &&
    original.kind === "beat" &&
    original.chapter === request.chapter &&
    original.id === request.originalArtifactId &&
    original.version === request.originalVersion &&
    original.humanStatus === "pending" &&
    variantCandidateMatches(request, value) &&
    isDeepStrictEqual(original.content, request.originalContent)
  );
}

function variantHeadMatches(
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  const selection = value.selection;
  return (
    selection.expectedHead.artifactId === request.expectedArtifactId &&
    selection.expectedHead.version === request.expectedHeadVersion &&
    selection.originalHead.artifactId === request.originalArtifactId &&
    selection.originalHead.version === request.originalVersion &&
    selection.resultHead.artifactId === value.artifact.id &&
    selection.resultHead.version === value.artifact.version &&
    selection.resultHead.humanStatus === value.artifact.humanStatus
  );
}

function variantIdentityMatches(
  workId: string,
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  const candidate = value.comparison.candidate;
  return (
    value.choice === request.choice &&
    value.selection.workId === workId &&
    value.selection.chapter === request.chapter &&
    value.selection.choice === request.choice &&
    variantHeadMatches(request, value) &&
    candidate.workId === workId &&
    candidate.kind === "beat" &&
    candidate.chapter === request.chapter &&
    value.comparison.original.id !== candidate.id
  );
}

function matchesBeatVariantSelection(
  workId: string,
  request: BeatVariantSelectionRequest,
  value: BeatVariantSelectionResponse,
): boolean {
  return (
    variantIdentityMatches(workId, request, value) &&
    variantOriginalMatches(workId, request, value) &&
    variantResultMatches(workId, request, value)
  );
}

function beatVariantSuccess(
  response: { status: number; body: unknown },
  workId: string,
  request: BeatVariantSelectionRequest,
) {
  const result = beatVariantSelectionResponseSchema.safeParse(response.body);
  if (
    !result.success ||
    !matchesBeatVariantSelection(workId, request, result.data)
  ) {
    throw new CliError(
      "Invalid server response; inspect the work before retrying a write",
      "invalid-response",
      { details: { writeOutcome: "unknown" } },
    );
  }
  return result.data;
}

function beatVariantHttpError(response: {
  status: number;
  body: unknown;
}): CliError {
  const failure = httpErrorSchema.safeParse(response.body);
  if (!failure.success) {
    return new CliError(
      "Invalid server response; inspect the work before retrying a write",
      "invalid-response",
      { details: { writeOutcome: "unknown" } },
    );
  }
  if (response.status >= 500) {
    return new CliError(failure.data.message, failure.data.code, {
      retryable: failure.data.retryable,
      attemptId: failure.data.attemptId,
      issues: failure.data.issues,
      details: {
        ...validationIssueDetails(failure.data),
        writeOutcome: "unknown",
      },
    });
  }
  return new CliError(failure.data.message, failure.data.code, {
    status: response.status,
    retryable: failure.data.retryable,
    attemptId: failure.data.attemptId,
    issues: failure.data.issues,
    details: validationIssueDetails(failure.data),
  });
}

export async function selectBeatVariant(
  client: Client,
  workId: string,
  input: unknown,
) {
  const parsed = beatVariantSelectionRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new CliError("Invalid Beat variant selection file", "invalid-input", {
      status: undefined,
      retryable: false,
      attemptId: undefined,
      issues: parsed.error.issues.map(({ path, code }) => ({
        path,
        code,
        message: "invalid field",
      })),
    });
  }
  const request: BeatVariantSelectionRequest = parsed.data;
  // This endpoint is intentionally one POST: a timeout is unknown and is
  // never resolved by a client-side retry or readback.
  const response: { status: number; body: unknown } =
    await client.selectBeatVariant(workId, request);
  if (response.status >= 200 && response.status < 300) {
    return beatVariantSuccess(response, workId, request);
  }
  throw beatVariantHttpError(response);
}

function proseConflictError(
  baseline: ReturnType<typeof proseArtifactSchema.parse>,
  local: Record<string, unknown>,
): CliError {
  return new CliError(
    "Request identity, version or status no longer matches; the file was not modified or submitted",
    "version-conflict",
    {
      status: 409,
      details: {
        ...local,
        resolution: "conflict",
        nextActions: ["read-work", "load-server-version"],
        observedHead: {
          artifactId: baseline.id,
          version: baseline.version,
          humanStatus: baseline.humanStatus,
        },
      },
    },
  );
}

function proseBaseline(
  work: WorkView,
  submission: ProseSubmission,
  local: Record<string, unknown>,
) {
  const baseline = proseArtifactSchema.safeParse(
    work.artifacts.find(
      (artifact) =>
        artifact.kind === "prose" &&
        artifact.chapter === submission.request.chapter,
    ),
  );
  if (!baseline.success) {
    throw new CliError(
      "No Prose for the requested chapter",
      "artifact-not-found",
      {
        status: 404,
        details: {
          ...local,
          resolution: "rejected",
          nextActions: ["read-work"],
          observedHead: null,
        },
      },
    );
  }
  const expectedStatus =
    submission.operation === "save-prose"
      ? submission.request.expectedHumanStatus
      : "pending";
  if (
    baseline.data.id !== submission.request.expectedArtifactId ||
    baseline.data.version !== submission.request.expectedHeadVersion ||
    baseline.data.humanStatus !== expectedStatus
  ) {
    throw proseConflictError(baseline.data, local);
  }
  return baseline.data;
}

function proseResultError(
  context: {
    local: Record<string, unknown>;
    recovery: ReturnType<typeof recoverProseSubmission>;
  },
  response: { status: number; body: unknown } | undefined,
  readback: {
    failure: ReturnType<typeof proseCommandErrorSchema.safeParse>;
    causeCode: string;
  },
): CliError {
  // 使用 Prose 专属错误码组装未确认结果。
  return commandResultError({
    message:
      "Prose command did not confirm the requested result; " +
      "keep the request file",
    conflictCode: "prose-result-conflict",
    unknownCode: "prose-result-unknown",
    local: context.local,
    recovery: context.recovery,
    response,
    failure: readback.failure,
    causeCode: readback.causeCode,
  });
}

async function readbackProse(
  client: Client,
  workId: string,
  response: { status: number; body: unknown } | undefined,
  causeCode: string,
) {
  const failure = proseCommandErrorSchema.safeParse(response?.body);
  // 用 Prose 错误 schema 对账最新作品。
  return readbackCommand(client, workId, { response, causeCode, failure });
}

async function recoverProseCommand(
  client: Client,
  context: {
    workId: string;
    submission: ProseSubmission;
    baseline: ReturnType<typeof proseArtifactSchema.parse>;
    local: Record<string, unknown>;
    recovery: ReturnType<typeof recoverProseSubmission>;
  },
  response: { status: number; body: unknown } | undefined,
  causeCode: string,
) {
  const { failure, latest, causeCode: readbackCode } = await readbackProse(
    client,
    context.workId,
    response,
    causeCode,
  );
  const recovered = recoverProseSubmission({
    baseline: context.baseline,
    submission: context.submission,
    hasUnknownWrite: context.recovery.hasUnknownWrite,
    response,
    work: latest,
    workIsReadback: latest !== undefined,
  });
  if (recovered.resolution === "confirmed") {
    return {
      artifact: recovered.artifact,
      resolution: recovered.resolution,
      nextActions: recovered.nextActions,
      confirmedBy: "read-work",
    };
  }
  throw proseResultError(
    { local: context.local, recovery: recovered },
    response,
    {
      failure,
      causeCode: readbackCode,
    },
  );
}

function makeProseSubmission(
  operation: ProseSubmission["operation"],
  data: unknown,
): ProseSubmission {
  if (operation === "approve-prose") {
    return { operation, request: proseApproveRequestSchema.parse(data) };
  }
  if (operation === "save-prose") {
    return { operation, request: proseSaveRequestSchema.parse(data) };
  }
  return {
    operation,
    request: proseRegenerateRequestSchema.parse(data),
  };
}

function proseLocal(workId: string, submission: ProseSubmission) {
  return {
    operation: submission.operation,
    target: { workId, kind: "prose", chapter: submission.request.chapter },
    expectedHead: {
      artifactId: submission.request.expectedArtifactId,
      version: submission.request.expectedHeadVersion,
      ...(submission.operation === "save-prose"
        ? { humanStatus: submission.request.expectedHumanStatus }
        : {}),
    },
  };
}

function proseSubmissionInput(
  operation: ProseSubmission["operation"],
  input: unknown,
): ProseSubmission {
  let schema:
    | typeof proseApproveRequestSchema
    | typeof proseSaveRequestSchema
    | typeof proseRegenerateRequestSchema = proseRegenerateRequestSchema;
  if (operation === "approve-prose") {
    schema = proseApproveRequestSchema;
  } else if (operation === "save-prose") {
    schema = proseSaveRequestSchema;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CliError("Invalid Prose request file", "invalid-input", {
      issues: parsed.error.issues.map(({ path, code }) => ({
        path,
        code,
        message: "invalid field",
      })),
    });
  }
  return makeProseSubmission(operation, parsed.data);
}

export async function runProseCommand(
  client: Client,
  workId: string,
  operation: ProseSubmission["operation"],
  input: unknown,
) {
  const submission = proseSubmissionInput(operation, input);
  const local = proseLocal(workId, submission);
  const work = await client.getWork(workId);
  const baseline = proseBaseline(work, submission, local);
  let response: { status: number; body: unknown } | undefined;
  let causeCode = "network-error";
  try {
    response = await client.proseCommand(workId, submission);
  } catch (error) {
    if (error instanceof CliError) {
      causeCode = error.code;
    }
  }
  const recovery = recoverProseSubmission({
    baseline,
    submission,
    hasUnknownWrite: false,
    response,
  });
  if (recovery.resolution === "confirmed") {
    return proseCommandResponseSchema.parse(response!.body);
  }
  return recoverProseCommand(
    client,
    { workId, submission, baseline, local, recovery },
    response,
    causeCode,
  );
}

export type SmokeResult = {
  workId: string;
  executionMode: "demo" | "live";
  steps: { step: string; ok: boolean; detail: string }[];
  final: WorkView;
};

type SmokeContext = {
  client: Client;
  steps: SmokeResult["steps"];
  workId?: string;
  executionMode: "demo" | "live" | "unknown";
  log: Logger;
};

async function smokeRun<T>(
  context: SmokeContext,
  step: string,
  run: () => Promise<T>,
  detail: (result: T) => string,
): Promise<T> {
  context.log(`[smoke] ${step} ...`);
  let result: T;
  try {
    result = await run();
  } catch (error) {
    const cause =
      error instanceof CliError
        ? error
        : new CliError("Smoke operation failed", "smoke-failed");
    context.steps.push({ step, ok: false, detail: cause.code });
    throw new CliError(cause.message, cause.code, {
      status: cause.status,
      retryable: cause.retryable,
      attemptId: cause.attemptId,
      issues: cause.issues,
      details: {
        ...cause.details,
        workId: context.workId,
        executionMode: context.executionMode,
        steps: context.steps,
      },
    });
  }
  context.steps.push({ step, ok: true, detail: detail(result) });
  context.log(`[smoke] ${step} ✓ ${detail(result)}`);
  return result;
}

async function smokeAdvance(client: Client, workId: string) {
  const outcome = await client.advance(workId);
  if (outcome.kind !== "failed") {
    return outcome;
  }
  let command = {};
  if (outcome.proseCommand) {
    command = { command: outcome.proseCommand };
  } else if (outcome.beatCommand) {
    command = { command: outcome.beatCommand };
  }
  throw new CliError(`Smoke stopped at ${outcome.stepId}`, outcome.code, {
    status: 200,
    retryable: outcome.retryable,
    attemptId: outcome.attemptId,
    details: {
      telemetry: outcome.telemetry,
      ...command,
      ...(outcome.inputBudget ? { inputBudget: outcome.inputBudget } : {}),
    },
  });
}

async function smokeAdvanceStep(
  context: SmokeContext,
  label: string,
  advance: () => ReturnType<typeof smokeAdvance>,
): Promise<void> {
  await smokeRun(context, label, advance, (outcome) => JSON.stringify(outcome));
}

async function smokeKindStep(
  context: SmokeContext,
  label: string,
  advance: () => ReturnType<typeof smokeAdvance>,
): Promise<void> {
  await smokeRun(context, label, advance, (outcome) => outcome.kind);
}

async function smokeOutlineStage(
  context: SmokeContext,
  advance: () => ReturnType<typeof smokeAdvance>,
): Promise<void> {
  await smokeRun(
    context,
    "select(first direction)",
    () => select(context.client, context.workId!),
    (artifact) => `v${artifact.version} ${artifact.humanStatus}`,
  );
  await smokeAdvanceStep(context, "advance#2(outline)", advance);
  await smokeRun(
    context,
    "approve(outline)",
    () => context.client.approve(context.workId!, "outline"),
    (outcome) => JSON.stringify(outcome),
  );
  await smokeAdvanceStep(context, "advance#3(setting)", advance);
}

async function smokeSettingStage(context: SmokeContext) {
  const pending = await smokeRun(
    context,
    "get(setting)",
    async () => {
      const current = await context.client.getWork(context.workId!);
      const parsed = settingArtifactSchema.safeParse(
        current.artifacts.find((artifact) => artifact.kind === "setting"),
      );
      if (!parsed.success || parsed.data.humanStatus !== "pending") {
        throw new CliError(
          "Smoke requires a pending setting before review",
          "smoke-incomplete",
        );
      }
      return parsed.data;
    },
    (artifact) => `v${artifact.version} pending`,
  );
  const request = {
    content: {
      ...pending.content,
      overview: `${pending.content.overview}\n\n作者确认：这是本次 smoke 的设定定稿。`,
    },
    expectedHeadVersion: pending.version,
  };
  await smokeRun(
    context,
    "approve-setting(edited)",
    () => approveSetting(context.client, context.workId!, request),
    (artifact) => `v${artifact.version} approved`,
  );
  return { pending, request };
}

async function smokeBeatStage(
  context: SmokeContext,
  advance: () => ReturnType<typeof smokeAdvance>,
) {
  await smokeKindStep(context, "advance#4(beat)", advance);
  const pendingBeat = await smokeRun(
    context,
    "get(beat#1)",
    async () => {
      const artifact = beatArtifactSchema.parse(
        await get(context.client, context.workId!, "beat", 1),
      );
      if (artifact.humanStatus !== "pending") {
        throw new CliError(
          "Smoke requires pending Beat review",
          "smoke-incomplete",
        );
      }
      return artifact;
    },
    (artifact) => `v${artifact.version} pending`,
  );
  const beatRequest = {
    chapter: 1 as const,
    expectedArtifactId: pendingBeat.id,
    expectedHeadVersion: pendingBeat.version,
    content: {
      ...pendingBeat.content,
      goal: `${pendingBeat.content.goal}\n\n作者确认：先保护证人，再追问线索。`,
    },
  };
  await smokeRun(
    context,
    "approve-beat(edited)",
    () =>
      runBeatCommand(
        context.client,
        context.workId!,
        "approve-beat",
        beatRequest,
      ),
    () => "approved",
  );
  return { pendingBeat, beatRequest };
}

async function pendingSmokeProse(context: SmokeContext) {
  return await smokeRun(
    context,
    "get(prose#1)",
    async () => {
      const current = await context.client.getWork(context.workId!);
      const artifact = proseArtifactSchema.safeParse(
        current.artifacts.find(
          (item) => item.kind === "prose" && item.chapter === 1,
        ),
      );
      if (!artifact.success || artifact.data.humanStatus !== "pending") {
        throw new CliError(
          "Smoke requires pending first-chapter Prose review",
          "smoke-incomplete",
        );
      }
      return artifact.data;
    },
    (artifact) => `v${artifact.version} pending`,
  );
}

async function smokeProseStage(
  context: SmokeContext,
  advance: () => ReturnType<typeof smokeAdvance>,
) {
  await smokeKindStep(context, "advance#5(prose)", advance);
  const pendingProse = await pendingSmokeProse(context);
  const proseContent = {
    text: `${pendingProse.content.text}\n\n作者定稿：先保护证人，再追问线索。\n`,
  };
  const savedProse = await smokeRun(
    context,
    "save-prose(edited)",
    async () => {
      const result = await runProseCommand(context.client, context.workId!, "save-prose", {
        chapter: 1,
        expectedArtifactId: pendingProse.id,
        expectedHeadVersion: pendingProse.version,
        expectedHumanStatus: "pending",
        content: proseContent,
      });
      return proseArtifactSchema.parse(result.artifact);
    },
    (artifact) => `v${artifact.version} ${artifact.humanStatus}`,
  );
  const proseRequest = {
    chapter: 1 as const,
    expectedArtifactId: savedProse.id,
    expectedHeadVersion: savedProse.version,
    content: proseContent,
  };
  await smokeRun(
    context,
    "approve-prose(saved)",
    () =>
      runProseCommand(
        context.client,
        context.workId!,
        "approve-prose",
        proseRequest,
      ),
    () => "approved",
  );
  return { savedProse, proseRequest };
}

function assertSmokeFinal(
  current: WorkView,
  artifacts: Parameters<typeof smokeFinal>[1],
): void {
      if (
        current.workflowState !== "prose-approved" ||
        !matchesBeatSubmission(
          artifacts.pendingBeat,
          artifacts.beatRequest,
          current.artifacts.find(
            (item) => item.kind === "beat" && item.chapter === 1,
          ),
        ) ||
        !matchesSettingSubmission(
          artifacts.pending,
          artifacts.request,
          current.artifacts.find((item) => item.kind === "setting"),
        ) ||
        !matchesProseSubmission(
          artifacts.savedProse,
          artifacts.proseRequest,
          current.artifacts.find(
            (item) => item.kind === "prose" && item.chapter === 1,
          ),
        ) ||
        current.artifacts.some((item) => (item.chapter ?? 0) > 1)
      ) {
        throw new CliError(
          "Smoke did not confirm the edited and approved first chapter",
          "smoke-incomplete",
        );
      }
}

async function smokeFinal(
  context: SmokeContext,
  artifacts: {
    pending: Awaited<ReturnType<typeof smokeSettingStage>>["pending"];
    request: Awaited<ReturnType<typeof smokeSettingStage>>["request"];
    pendingBeat: Awaited<ReturnType<typeof smokeBeatStage>>["pendingBeat"];
    beatRequest: Awaited<ReturnType<typeof smokeBeatStage>>["beatRequest"];
    savedProse: Awaited<ReturnType<typeof smokeProseStage>>["savedProse"];
    proseRequest: Awaited<ReturnType<typeof smokeProseStage>>["proseRequest"];
  },
) {
  return smokeRun(
    context,
    "get(final)",
    async () => {
      const current = await context.client.getWork(context.workId!);
      assertSmokeFinal(current, artifacts);
      return current;
    },
    (current) => current.workflowState,
  );
}

async function smokeSetup(
  context: SmokeContext,
  args: { seed: string; title?: string },
) {
  const mode = await smokeRun(
    context,
    "config",
    () => context.client.getConfig(),
    (config) => (config.demo ? "demo" : "live"),
  );
  context.executionMode = mode.demo ? "demo" : "live";
  const work = await smokeRun(
    context,
    "create",
    () => context.client.createWork(args),
    (created) => created.id,
  );
  context.workId = work.id;
  return { work, advance: () => smokeAdvance(context.client, work.id) };
}

// 一键全链路探针包含正文编辑保存与通过，最后回读核验首章定稿。
export async function smoke(
  client: Client,
  args: { seed: string; title?: string },
  log: Logger,
): Promise<SmokeResult> {
  const context: SmokeContext = {
    client,
    steps: [],
    executionMode: "unknown",
    log,
  };
  const { work, advance } = await smokeSetup(context, args);
  await smokeRun(context, "advance#1(caption+creative)", advance, (outcome) =>
    JSON.stringify(outcome),
  );
  await smokeOutlineStage(context, advance);
  const { pending, request } = await smokeSettingStage(context);
  const { pendingBeat, beatRequest } = await smokeBeatStage(context, advance);
  const { savedProse, proseRequest } = await smokeProseStage(context, advance);
  const final = await smokeFinal(context, {
    pending,
    request,
    pendingBeat,
    beatRequest,
    savedProse,
    proseRequest,
  });
  return {
    workId: work.id,
    executionMode: context.executionMode as SmokeResult["executionMode"],
    steps: context.steps,
    final,
  };
}
