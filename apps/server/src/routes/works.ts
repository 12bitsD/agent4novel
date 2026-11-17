import { Hono } from "hono";
import { contractJson, responseUnavailable } from "../contract-response.js";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { z } from "zod";
import {
  creativeContentSchema,
  creativeLimits,
  creativeRegenerateRequestSchema,
  outlineContentSchema,
  settingApproveRequestSchema,
  settingLimits,
  beatApproveRequestSchema,
  beatRequestHeadSchema,
  beatLimits,
  beatCommandResponseSchema,
  beatCommandErrorSchema,
  beatRegenerateRequestSchema,
  beatVariantSelectionRequestSchema,
  beatVariantSelectionResponseSchema,
  proseApproveRequestSchema,
  proseRequestHeadSchema,
  proseSaveRequestHeadSchema,
  proseLimits,
  proseCommandResponseSchema,
  proseCommandErrorSchema,
  proseRegenerateRequestSchema,
  proseSaveRequestSchema,
  diagnosticQuerySchema,
  workViewSchema,
  startChapterRequestSchema,
  workCreateRequestSchema,
  workListResponseSchema,
  workSchema,
  artifactSchema,
  historicalArtifactRequestSchema,
  creativeDraftRequestSchema,
  selectCreativeRequestSchema,
  outlineDraftRequestSchema,
  approveRequestSchema,
  outlineApprovalRequestSchema,
  outlineApprovalResponseSchema,
  outlineApprovalRequestBytes,
  advanceOutcomeDtoSchema,
  pipelineStateSchema,
  settingApproveResponseSchema,
  diagnosticResponseSchema,
  httpErrorSchema,
} from "@agent4novel/contracts";
import type {
  ApiError,
  Artifact,
  JsonValue,
  HumanStatus,
  ArtifactKind,
  OutlineContent,
  OutlineDraft,
  WorkflowState,
  WorkView,
  LlmTelemetry,
} from "@agent4novel/contracts";
import type { Pipeline } from "../pipeline/pipeline.js";
import { KnownError } from "../errors.js";
import {
  diagnosticsFor,
  withRequest,
  currentRequest,
  recordCommand,
} from "../steps/telemetry.js";
import type { WorkStore } from "../store/work-store.js";
import { approveSetting, SettingValidationError } from "../setting-review.js";
import { approveBeat } from "../beat-review.js";
import {
  observeBeat,
  BeatCommandError,
  beatFailureCode,
} from "../beat-command.js";
import { approveProse, saveProse } from "../prose-review.js";
import {
  observeProse,
  ProseCommandError,
  proseFailureCode,
  proseResponseError,
} from "../prose-command.js";
import { safeLog } from "../safe-log.js";
import {
  chapterSummaries,
  chapterWorkflow,
  currentChapterOf,
} from "../chapter-view.js";
import { formatValidationIssues } from "./validation-issues.js";

// id 规整(#4 决策 6):已有 id 保留(上下移/编辑不动标识),新项(无 id)按「已有及本次已分配最大序号 +1」
// 补注入,保持与生成时相同的位置编号格式(删除后按位置重排会撞号,故取 max+1)
function nextId(prefix: string, existing: string[]): string {
  // reduce：汇总元素。
  const max = existing.reduce((m, id) => {
    // exec：处理当前步骤。
    const match = /(\d+)$/.exec(id);
    if (!match) {
      return m;
    }
    // BigInt：处理当前步骤。
    const value = BigInt(match[1]);
    return value > m ? value : m;
  }, 0n);
  return `${prefix}${max + 1n}`;
}

function normalizeOutlineIds(
  workId: string,
  draft: OutlineDraft,
): OutlineContent {
  // map：转换数组元素。
  const arcIds = draft.arcs.map((arc) => arc.arcId ?? "");
  // flatMap：处理当前步骤。
  // map：转换数组元素。
  const usedSegmentIds = new Set(
    draft.arcs.flatMap((arc) =>
      arc.segments.map((segment) => segment.segmentId ?? ""),
    ),
  );
  // map：转换数组元素。
  const content = {
    arcs: draft.arcs.map((arc) => {
      // nextId：处理当前步骤。
      const arcId = arc.arcId ?? nextId(`${workId}-arc-`, arcIds);
      // push：追加元素。
      arcIds.push(arcId);
      // map：转换数组元素。
      const segmentIds = arc.segments.map((segment) => segment.segmentId ?? "");
      // map：转换数组元素。
      return {
        ...arc,
        arcId,
        segments: arc.segments.map((seg) => {
          let segmentId = seg.segmentId;
          if (!segmentId) {
            // nextId：处理当前步骤。
            segmentId = nextId(`${arcId}-seg-`, segmentIds);
            // push：追加元素。
            segmentIds.push(segmentId);
            // has：检查存在性。
            while (usedSegmentIds.has(segmentId)) {
              // nextId：处理当前步骤。
              segmentId = nextId(`${arcId}-seg-`, segmentIds);
              // push：追加元素。
              segmentIds.push(segmentId);
            }
            // add：处理当前步骤。
            usedSegmentIds.add(segmentId);
          }
          return { ...seg, segmentId };
        }),
      };
    }),
  };
  // parse：解析输入。
  return outlineContentSchema.parse(content);
}

function errorBody(
  code: string,
  message: string,
  retryable = false,
  attemptId?: string,
): ApiError {
  return { code, message, retryable, ...(attemptId ? { attemptId } : {}) };
}

function invalidFields(error: z.ZodError) {
  // map：转换数组元素。
  return error.issues.map(({ path, code }) => ({
    path,
    code,
    message: "invalid field",
  }));
}

async function readJsonBody(
  c: Context,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    // json：构造 JSON 响应。
    return { ok: true, data: await c.req.json() };
  } catch {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return {
      ok: false,
      response: c.json(errorBody("bad-json", "invalid json body"), 400),
    };
  }
}

// 错误分类(#3c 决策 16):依赖未就绪/版本冲突 409,内容非法 400/422,
// 模型输出非法 502,不可用/超时 503/504,未知 500
function routeError(c: Context, err: unknown): Response {
  // String：转换字符串。
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof KnownError) {
    // errorBody：处理当前步骤。
    const body = errorBody(err.code, msg, err.retryable, err.attemptId);
    switch (err.code) {
      case "invalid-input":
        // json：构造 JSON 响应。
        return c.json(body, 400);
      case "work-not-found":
      case "artifact-not-found":
        // json：构造 JSON 响应。
        return c.json(body, 404);
      case "chapter-not-ready":
      case "advance-in-progress":
      case "version-conflict":
      case "upstream-changed":
      case "artifact-already-approved":
      case "setting-gate-not-ready":
      case "setting-approval-required":
      case "beat-approval-required":
      case "beat-gate-not-ready":
      case "prose-approval-required":
      case "prose-gate-not-ready":
      case "direction-not-selected":
        // json：构造 JSON 响应。
        return c.json(body, 409);
      case "llm-invalid-output":
        // json：构造 JSON 响应。
        return c.json(body, 502);
      case "llm-timeout":
        // json：构造 JSON 响应。
        return c.json(body, 504);
      case "llm-unavailable":
        // json：构造 JSON 响应。
        return c.json(body, 503);
      case "input-budget-exceeded":
        // json：构造 JSON 响应。
        return c.json(body, 422);
    }
  }
  // responseUnavailable：处理当前步骤。
  return responseUnavailable(c);
}

// The same observed head validates the request and conditions the actual
// store commit.
function assertHead(
  c: Context,
  head: Artifact | undefined,
  expected: number,
): Response | null {
  if (!head || head.version !== expected) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(errorBody("version-conflict", "artifact head changed"), 409);
  }
  return null;
}

function appendFromHead(
  c: Context,
  store: WorkStore,
  input: { head: Artifact; content: JsonValue; humanStatus?: HumanStatus },
) {
  try {
    // appendArtifact：写入当前结果。
    const artifact = store.appendArtifact(
      input.head.workId,
      input.head.kind,
      input.content,
      {
        chapter: input.head.chapter,
        humanStatus: input.humanStatus ?? "pending",
        preconditions: [
          {
            kind: input.head.kind,
            chapter: input.head.chapter,
            head: {
              artifactId: input.head.id,
              version: input.head.version,
              humanStatus: input.head.humanStatus,
            },
          },
        ],
      },
    );
    // contractJson：处理当前步骤。
    return contractJson(c, artifactSchema, artifact);
  } catch (error) {
    // routeError：处理当前步骤。
    return routeError(c, error);
  }
}

type WorkflowView = {
  workflowState: WorkflowState;
  allowedActions: string[];
};

const approvalViews: Partial<Record<ArtifactKind, WorkflowView>> = {
  creative: {
    workflowState: "awaiting-selection",
    allowedActions: ["save-draft", "select", "generate"],
  },
  outline: {
    workflowState: "awaiting-outline-review",
    allowedActions: ["save-draft", "approve"],
  },
  setting: {
    workflowState: "awaiting-setting-review",
    allowedActions: ["approve"],
  },
  beat: {
    workflowState: "awaiting-beat-review",
    allowedActions: ["approve", "regenerate"],
  },
  prose: {
    workflowState: "awaiting-prose-review",
    allowedActions: ["save-draft", "approve", "regenerate"],
  },
};

function readyWorkflow(
  // bits:allow(BCS004): retryable 是失败读模型的数据字段，不是行为切换开关
  failure: { stepId: string; code: string; retryable: boolean } | null,
): WorkflowView {
  if (failure) {
    return {
      workflowState: "failed",
      allowedActions: failure.retryable ? ["generate"] : [],
    };
  }
  return { workflowState: "ready-to-generate", allowedActions: ["generate"] };
}

function completedWorkflow(
  completionKind: ArtifactKind | undefined,
): WorkflowView {
  if (completionKind === "prose") {
    return { workflowState: "prose-approved", allowedActions: ["save-draft"] };
  }
  if (completionKind === "beat") {
    return { workflowState: "beat-approved", allowedActions: [] };
  }
  if (completionKind === "setting") {
    return { workflowState: "setting-approved", allowedActions: [] };
  }
  return { workflowState: "outline-approved", allowedActions: [] };
}

// 读模型(#3c 决策 11,#4 按 pendingGate.kind 分派):与 artifacts 同一快照派生,web 只渲染不重建状态机
function workflowOf(
  state: ReturnType<Pipeline["getState"]>,
  // bits:allow(BCS004): retryable 是失败读模型的数据字段，不是行为切换开关
  failure: { stepId: string; code: string; retryable: boolean } | null,
  completionKind: ArtifactKind | undefined,
): WorkflowView {
  switch (state.stage) {
    case "ready":
      // readyWorkflow：读取当前数据。
      return readyWorkflow(failure);
    case "awaiting-approval": {
      const gate = state.pendingGate?.kind;
      const view = gate ? approvalViews[gate] : undefined;
      if (!view) {
        throw new Error(`unknown gate kind: ${gate ?? "none"}`);
      }
      return view;
    }
    case "complete":
      // completedWorkflow：处理当前步骤。
      return completedWorkflow(completionKind);
    case "blocked":
      return { workflowState: "ready-to-generate", allowedActions: [] };
  }
}

export type WorksRoutesDeps = {
  store: WorkStore;
  pipeline: Pipeline;
  // 生产装配按所选 provider 的凭据决定 live/demo；路由只消费该模式，不绑定特定 provider。
  meta?: { demo: boolean };
};

function registerHistoryRoutes(app: Hono, store: WorkStore): void {
  // Historical chapter artifacts are an explicit Harness read surface. The
  // current work view intentionally exposes only heads; this route requires
  // both the immutable identity and version so a caller cannot accidentally
  // treat a newer head as the requested history.
  // get：读取值。
  app.get("/api/works/:id/artifacts/:kind/:chapter/versions/:version", (c) => {
    // safeParse：校验并解析输入。
    // param：处理当前步骤。
    // param：处理当前步骤。
    // param：处理当前步骤。
    // query：处理当前步骤。
    const parsed = historicalArtifactRequestSchema.safeParse({
      kind: c.req.param("kind"),
      chapter: c.req.param("chapter"),
      version: c.req.param("version"),
      artifactId: c.req.query("artifactId"),
    });
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(
        errorBody("invalid-input", "invalid historical artifact reference"),
        400,
      );
    }
    // getWork：读取当前数据。
    // param：处理当前步骤。
    if (!store.getWork(c.req.param("id"))) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("work-not-found", "work not found"), 404);
    }
    // getArtifactVersion：读取当前数据。
    // param：处理当前步骤。
    const artifact = store.getArtifactVersion(
      c.req.param("id"),
      parsed.data.kind,
      parsed.data.chapter,
      parsed.data.artifactId,
      parsed.data.version,
    );
    if (!artifact) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(
        errorBody("artifact-not-found", "artifact version not found"),
        404,
      );
    }
    // contractJson：处理当前步骤。
    return contractJson(c, artifactSchema, artifact);
  });
}

function beatVariantError(c: Context, error: unknown): Response {
  if (error instanceof KnownError) {
    const status =
      error.code === "work-not-found" || error.code === "artifact-not-found"
        ? 404
        : 409;
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(
      errorBody(error.code, error.message, error.retryable),
      status,
    );
  }
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  return c.json(
    errorBody("internal-error", "beat variant selection unavailable"),
    500,
  );
}

function registerBeatVariantRoute(
  app: Hono,
  { pipeline }: WorksRoutesDeps,
): void {
  // post：注册 POST 路由。
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  app.post(
    "/api/works/:id/artifacts/beat/select",
    bodyLimit({
      maxSize: beatLimits.bodyBytes,
      onError: (c) =>
        c.json(errorBody("payload-too-large", "request body too large"), 413),
    }),
    async (c) => {
      // readJsonBody：读取当前数据。
      const body = await readJsonBody(c);
      if (!body.ok) {
        return body.response;
      }
      // safeParse：校验并解析输入。
      const parsed = beatVariantSelectionRequestSchema.safeParse(body.data);
      if (!parsed.success) {
        // json：构造 JSON 响应。
        // errorBody：处理当前步骤。
        return c.json(
          errorBody("invalid-input", "invalid beat variant selection"),
          400,
        );
      }
      try {
        // selectBeatVariant：读取当前数据。
        // param：处理当前步骤。
        const result = await pipeline.selectBeatVariant(
          c.req.param("id"),
          parsed.data,
        );
        // json：构造 JSON 响应。
        // parse：解析输入。
        return c.json(beatVariantSelectionResponseSchema.parse(result));
      } catch (error) {
        // beatVariantError：处理当前步骤。
        return beatVariantError(c, error);
      }
    },
  );
}

function registerProseOutlineRoute(
  app: Hono,
  { pipeline }: WorksRoutesDeps,
): void {
  // post：注册 POST 路由。
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  app.post(
    "/api/works/:id/artifacts/outline/approve",
    bodyLimit({
      maxSize: outlineApprovalRequestBytes,
      onError: (c) =>
        c.json(
          errorBody(
            "payload-too-large",
            "outline approval request exceeds body limit",
          ),
          413,
        ),
    }),
    async (c) => {
      // readJsonBody：读取当前数据。
      const body = await readJsonBody(c);
      if (!body.ok) {
        return body.response;
      }
      // safeParse：校验并解析输入。
      const parsed = outlineApprovalRequestSchema.safeParse(body.data);
      if (!parsed.success) {
        // json：构造 JSON 响应。
        // errorBody：处理当前步骤。
        // invalidFields：处理当前步骤。
        return c.json(
          {
            ...errorBody("invalid-input", "invalid outline approval request"),
            issues: invalidFields(parsed.error),
          },
          400,
        );
      }
      try {
        // contractJson：处理当前步骤。
        // approveOutline：处理当前步骤。
        // param：处理当前步骤。
        return contractJson(
          c,
          outlineApprovalResponseSchema,
          pipeline.approveOutline(c.req.param("id"), parsed.data),
        );
      } catch (error) {
        // routeError：处理当前步骤。
        return routeError(c, error);
      }
    },
  );
}

function settingInvalid(c: Context, error: z.ZodError): Response {
  // every：检查全部匹配。
  const contentError = error.issues.every(
    (issue) => issue.path[0] === "content",
  );
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  // map：转换数组元素。
  return c.json(
    {
      ...errorBody(
        contentError ? "invalid-content" : "invalid-input",
        "invalid setting request",
      ),
      issues: error.issues.map(({ path, code, message }) => ({
        path,
        code,
        message,
      })),
    },
    contentError ? 422 : 400,
  );
}

function settingError(c: Context, error: unknown): Response {
  if (error instanceof SettingValidationError) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    // map：转换数组元素。
    return c.json(
      {
        ...errorBody("invalid-content", "invalid setting content"),
        issues: error.issues.map(({ path, code, message }) => ({
          path: ["content", ...path],
          code,
          message,
        })),
      },
      422,
    );
  }
  // routeError：处理当前步骤。
  return routeError(
    c,
    error instanceof KnownError ? error : new Error("setting approval failed"),
  );
}

function registerSettingApprovalRoute(app: Hono, store: WorkStore): void {
  // post：注册 POST 路由。
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  app.post(
    "/api/works/:id/artifacts/setting/approve",
    bodyLimit({
      maxSize: settingLimits.bodyBytes,
      onError: (c) =>
        c.json(
          errorBody("payload-too-large", "setting request exceeds body limit"),
          413,
        ),
    }),
    async (c) => {
      // readJsonBody：读取当前数据。
      const body = await readJsonBody(c);
      if (!body.ok) {
        return body.response;
      }
      // safeParse：校验并解析输入。
      const parsed = settingApproveRequestSchema.safeParse(body.data);
      if (!parsed.success) {
        // settingInvalid：处理当前步骤。
        return settingInvalid(c, parsed.error);
      }
      try {
        // contractJson：处理当前步骤。
        // approveSetting：处理当前步骤。
        // param：处理当前步骤。
        return contractJson(
          c,
          settingApproveResponseSchema,
          approveSetting(store, c.req.param("id"), parsed.data),
        );
      } catch (err) {
        // settingError：处理当前步骤。
        return settingError(c, err);
      }
    },
  );
}

function registerWorkViewRoute(
  app: Hono,
  { store, pipeline }: WorksRoutesDeps,
): void {
  // get：读取值。
  app.get("/api/works/:id", (c) => {
    // param：处理当前步骤。
    const workId = c.req.param("id");
    // getWork：读取当前数据。
    const work = store.getWork(workId);
    if (!work) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("work-not-found", "not found"), 404);
    }
    // getStateFromWork：读取当前数据。
    const state = pipeline.getStateFromWork(work);
    // currentChapterOf：读取当前数据。
    // chapterSummaries：处理当前步骤。
    // workflowOf：处理当前步骤。
    // failureOf：处理当前步骤。
    const view: WorkView = {
      ...work,
      currentChapter: currentChapterOf(work),
      chapters: chapterSummaries(
        work,
        pipeline.repeatChapters ? "start-next-chapter" : null,
      ),
      ...workflowOf(
        state,
        pipeline.failureOf(workId, state.nextStepId),
        pipeline.completionKind,
      ),
      nextStepId: state.nextStepId,
    };
    // safeParse：校验并解析输入。
    const parsed = workViewSchema.safeParse(view);
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("internal-error", "invalid work snapshot"), 500);
    }
    // json：构造 JSON 响应。
    return c.json(parsed.data);
  });
}

function selectCreative(
  c: Context,
  store: WorkStore,
  work: NonNullable<ReturnType<WorkStore["getWork"]>>,
  request: z.infer<typeof selectCreativeRequestSchema>,
): Response {
  // find：查找元素。
  const current = work.artifacts.find(
    (artifact) => artifact.kind === "creative",
  );
  // assertHead：校验当前条件。
  const conflict = assertHead(c, current, request.expectedHeadVersion);
  if (conflict) {
    return conflict;
  }
  // safeParse：校验并解析输入。
  const content = creativeContentSchema.safeParse(current?.content);
  if (!current || !content.success) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(errorBody("artifact-not-found", "no creative artifact"), 404);
  }
  // find：查找元素。
  const pack = content.data.directions.find(
    (direction) => direction.directionId === request.directionId,
  );
  if (!pack) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(
      errorBody(
        "direction-not-selected",
        `direction not found: ${request.directionId}`,
      ),
      409,
    );
  }
  // appendFromHead：写入当前结果。
  return appendFromHead(c, store, {
    head: current,
    content: { directions: [pack] },
    humanStatus: "approved",
  });
}

function registerCreativeSelectionRoute(app: Hono, store: WorkStore): void {
  // selectCreativeDirection:显式选定单方向 → 单方向新版本 + approved
  // post：注册 POST 路由。
  app.post("/api/works/:id/artifacts/creative/select", async (c) => {
    // param：处理当前步骤。
    const workId = c.req.param("id");
    // getWork：读取当前数据。
    const work = store.getWork(workId);
    if (!work) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("work-not-found", "not found"), 404);
    }
    // readJsonBody：读取当前数据。
    const body = await readJsonBody(c);
    if (!body.ok) {
      return body.response;
    }
    // safeParse：校验并解析输入。
    const parsed = selectCreativeRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      // invalidFields：处理当前步骤。
      return c.json(
        {
          ...errorBody("invalid-input", "invalid input"),
          issues: invalidFields(parsed.error),
        },
        400,
      );
    }
    // selectCreative：读取当前数据。
    return selectCreative(c, store, work, parsed.data);
  });
}

function normalizedOutline(
  c: Context,
  workId: string,
  draft: OutlineDraft,
): OutlineContent | Response {
  try {
    // normalizeOutlineIds：转换当前数据。
    return normalizeOutlineIds(workId, draft);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      throw error;
    }
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    // invalidFields：处理当前步骤。
    return c.json(
      {
        ...errorBody("invalid-content", "invalid content"),
        issues: invalidFields(error),
      },
      422,
    );
  }
}

function registerOutlineRoutes(app: Hono, store: WorkStore): void {
  // saveOutlineDraft(#4):保存大纲草稿,永远 pending;新版通过走专用可见版本条件命令。
  // put：注册 PUT 路由。
  app.put("/api/works/:id/artifacts/outline", async (c) => {
    // param：处理当前步骤。
    const workId = c.req.param("id");
    // getWork：读取当前数据。
    const work = store.getWork(workId);
    if (!work) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("work-not-found", "not found"), 404);
    }
    // readJsonBody：读取当前数据。
    const body = await readJsonBody(c);
    if (!body.ok) {
      return body.response;
    }
    // safeParse：校验并解析输入。
    const parsed = outlineDraftRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      // invalidFields：处理当前步骤。
      return c.json(
        {
          ...errorBody("invalid-content", "invalid content"),
          issues: invalidFields(parsed.error),
        },
        422,
      );
    }
    // find：查找元素。
    const current = work.artifacts.find((a) => a.kind === "outline");
    // assertHead：校验当前条件。
    const conflict = assertHead(c, current, parsed.data.expectedHeadVersion);
    if (conflict) {
      return conflict;
    }
    // normalizedOutline：转换当前数据。
    const content = normalizedOutline(c, workId, parsed.data.content);
    if (content instanceof Response) {
      return content;
    }
    // appendFromHead：写入当前结果。
    return appendFromHead(c, store, { head: current!, content });
  });
}

function matchingDirectionIds(
  current: Artifact | undefined,
  draft: z.infer<typeof creativeDraftRequestSchema>["content"],
): boolean {
  // map：转换数组元素。
  // parse：解析输入。
  const currentIds = new Set(
    creativeContentSchema
      .parse(current!.content)
      .directions.map((direction) => direction.directionId),
  );
  // map：转换数组元素。
  const submittedIds = new Set(
    draft.directions.map((direction) => direction.directionId),
  );
  // every：检查全部匹配。
  // has：检查存在性。
  return (
    submittedIds.size === currentIds.size &&
    [...submittedIds].every((id) => currentIds.has(id))
  );
}

function registerCreativeDraftRoute(app: Hono, store: WorkStore): void {
  // saveCreativeDraft:存全部方向,永远 pending(不再是「人工保存即通过」)
  // put：注册 PUT 路由。
  app.put("/api/works/:id/artifacts/creative", async (c) => {
    // param：处理当前步骤。
    const workId = c.req.param("id");
    // getWork：读取当前数据。
    const work = store.getWork(workId);
    if (!work) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("work-not-found", "not found"), 404);
    }
    // readJsonBody：读取当前数据。
    const body = await readJsonBody(c);
    if (!body.ok) {
      return body.response;
    }
    // safeParse：校验并解析输入。
    const parsed = creativeDraftRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      // invalidFields：处理当前步骤。
      return c.json(
        {
          ...errorBody("invalid-content", "invalid content"),
          issues: invalidFields(parsed.error),
        },
        422,
      );
    }
    // find：查找元素。
    const current = work.artifacts.find((a) => a.kind === "creative");
    // assertHead：校验当前条件。
    const conflict = assertHead(c, current, parsed.data.expectedHeadVersion);
    if (conflict) {
      return conflict;
    }
    // matchingDirectionIds：处理当前步骤。
    if (!matchingDirectionIds(current, parsed.data.content)) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(
        errorBody(
          "invalid-content",
          "direction ids must match the current head",
        ),
        422,
      );
    }
    // appendFromHead：写入当前结果。
    return appendFromHead(c, store, {
      head: current!,
      content: parsed.data.content,
    });
  });
}

function registerCreativeRoutes(app: Hono, store: WorkStore): void {
  // registerCreativeDraftRoute：处理当前步骤。
  registerCreativeDraftRoute(app, store);
  // registerCreativeSelectionRoute：处理当前步骤。
  registerCreativeSelectionRoute(app, store);
}

function registerWorkCollectionRoutes(app: Hono, store: WorkStore): void {
  // get：读取值。
  // contractJson：处理当前步骤。
  // listWorks：读取当前数据。
  app.get("/api/works", (c) =>
    contractJson(c, workListResponseSchema, store.listWorks()),
  );

  // post：注册 POST 路由。
  app.post("/api/works", async (c) => {
    // readJsonBody：读取当前数据。
    const body = await readJsonBody(c);
    if (!body.ok) {
      return body.response;
    }
    // safeParse：校验并解析输入。
    const parsed = workCreateRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      // invalidFields：处理当前步骤。
      return c.json(
        {
          ...errorBody("invalid-input", "invalid input"),
          issues: invalidFields(parsed.error),
        },
        400,
      );
    }
    // createWork：构造当前数据。
    const work = store.createWork(parsed.data);
    // contractJson：处理当前步骤。
    return contractJson(c, workSchema, work, 201);
  });
}

function registerWorkReadRoutes(
  app: Hono,
  { store, pipeline }: WorksRoutesDeps,
): void {
  // registerWorkCollectionRoutes：处理当前步骤。
  registerWorkCollectionRoutes(app, store);
  // registerWorkViewRoute：处理当前步骤。
  registerWorkViewRoute(app, { store, pipeline });
}

function creativeRegenerationError(
  c: Context,
  workId: string,
  error: unknown,
): Response {
  // safeLog：处理当前步骤。
  // currentRequest：读取当前数据。
  safeLog({
    event: "pipeline.creative-regenerate",
    requestId: currentRequest()!.requestId,
    workId,
    outcome: "failed",
  });
  if (error instanceof z.ZodError) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(
      errorBody("llm-invalid-output", "creative output unavailable", true),
      502,
    );
  }
  // routeError：处理当前步骤。
  return routeError(c, error);
}

async function runCreativeRegeneration(
  c: Context,
  pipeline: Pipeline,
  workId: string,
  request: z.infer<typeof creativeRegenerateRequestSchema>,
): Promise<Response> {
  try {
    // regenerateCreative：处理当前步骤。
    const artifact = await pipeline.regenerateCreative(workId, request);
    // safeLog：处理当前步骤。
    // currentRequest：读取当前数据。
    safeLog({
      event: "pipeline.creative-regenerate",
      requestId: currentRequest()!.requestId,
      workId,
      outcome: "committed",
      version: artifact.version,
    });
    // contractJson：处理当前步骤。
    return contractJson(c, artifactSchema, artifact);
  } catch (error) {
    // creativeRegenerationError：处理当前步骤。
    return creativeRegenerationError(c, workId, error);
  }
}

function invalidCreativeRegeneration(c: Context, error: z.ZodError): Response {
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  // invalidFields：处理当前步骤。
  return c.json(
    {
      ...errorBody("invalid-input", "invalid creative regeneration request"),
      issues: invalidFields(error),
    },
    400,
  );
}

function registerCreativeRegenerationRoute(
  app: Hono,
  { pipeline, meta }: WorksRoutesDeps,
): void {
  // creative 再生固定作者看到的 creative/caption 基线；成功只返回新 pending head。
  // use：注册中间件。
  // withRequest：处理当前步骤。
  // randomUUID：生成随机 ID。
  app.use("/api/works/:id/artifacts/creative/regenerate", async (_c, next) =>
    withRequest(
      crypto.randomUUID(),
      (meta?.demo ?? true) ? "demo" : "live",
      next,
    ),
  );
  // post：注册 POST 路由。
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  app.post(
    "/api/works/:id/artifacts/creative/regenerate",
    bodyLimit({
      maxSize: creativeLimits.bodyBytes,
      onError: (c) =>
        c.json(
          errorBody(
            "payload-too-large",
            "creative regeneration request exceeds body limit",
          ),
          413,
        ),
    }),
    async (c) => {
      // readJsonBody：读取当前数据。
      const body = await readJsonBody(c);
      if (!body.ok) {
        return body.response;
      }
      // safeParse：校验并解析输入。
      const parsed = creativeRegenerateRequestSchema.safeParse(body.data);
      if (!parsed.success) {
        // invalidCreativeRegeneration：处理当前步骤。
        return invalidCreativeRegeneration(c, parsed.error);
      }
      // runCreativeRegeneration：执行当前流程。
      // param：处理当前步骤。
      return runCreativeRegeneration(
        c,
        pipeline,
        c.req.param("id"),
        parsed.data,
      );
    },
  );
}

function registerCreativeOperations(
  app: Hono,
  { store, pipeline, meta }: WorksRoutesDeps,
): void {
  // registerCreativeRegenerationRoute：处理当前步骤。
  registerCreativeRegenerationRoute(app, { store, pipeline, meta });
  // registerSettingApprovalRoute：处理当前步骤。
  registerSettingApprovalRoute(app, store);
}

type ProseRouteOperation = "approve" | "regenerate" | "save";

function proseOperationFromPath(path: string) {
  // endsWith：处理当前步骤。
  if (path.endsWith("/save")) {
    return "save-prose" as const;
  }
  // endsWith：处理当前步骤。
  if (path.endsWith("/regenerate")) {
    return "regenerate-prose" as const;
  }
  return "approve-prose" as const;
}
type ProseHead = {
  data: z.infer<typeof proseRequestHeadSchema> & {
    expectedHumanStatus?: "pending" | "approved";
  };
};
type ProseReject = (
  c: Context,
  code:
    | "bad-json"
    | "invalid-input"
    | "unsupported-chapter"
    | "payload-too-large",
) => Response;

function proseSchema(operation: ProseRouteOperation) {
  if (operation === "approve") {
    return proseApproveRequestSchema;
  }
  if (operation === "save") {
    return proseSaveRequestSchema;
  }
  return proseRegenerateRequestSchema;
}

function proseOperationName(operation: ProseRouteOperation) {
  if (operation === "approve") {
    return "approve-prose" as const;
  }
  if (operation === "save") {
    return "save-prose" as const;
  }
  return "regenerate-prose" as const;
}

async function executeProseResult(
  operation: ProseRouteOperation,
  data: unknown,
  workId: string,
  deps: WorksRoutesDeps,
) {
  if (operation === "approve") {
    // approveProse：处理当前步骤。
    // parse：解析输入。
    return approveProse(
      deps.store,
      workId,
      proseApproveRequestSchema.parse(data),
    );
  }
  if (operation === "save") {
    // saveProse：写入当前结果。
    // parse：解析输入。
    return saveProse(deps.store, workId, proseSaveRequestSchema.parse(data));
  }
  // regenerateProse：处理当前步骤。
  // parse：解析输入。
  return deps.pipeline.regenerateProse(
    workId,
    proseRegenerateRequestSchema.parse(data),
  );
}

async function observeInvalidProse(
  operation: ProseRouteOperation,
  head: ProseHead,
  parsed: { success: false; error: z.ZodError },
  workId: string,
): Promise<void> {
  // observeProse：记录当前观测。
  // proseOperationName：处理当前步骤。
  await observeProse(
    { workId, chapter: head.data.chapter },
    proseOperationName(operation),
    {
      artifactId: head.data.expectedArtifactId,
      version: head.data.expectedHeadVersion,
      ...(operation === "save"
        ? { humanStatus: head.data.expectedHumanStatus }
        : {}),
    },
    (execution) => {
      // enter：标记执行阶段。
      execution.enter("input");
      throw parsed.error;
    },
  );
}

function proseSuccess(
  c: Context,
  operation: ProseRouteOperation,
  head: ProseHead,
  context: {
    workId: string;
    result: Awaited<ReturnType<typeof executeProseResult>>;
    pipeline: Pipeline;
    store: WorkStore;
  },
): Response {
  try {
    // getState：读取当前数据。
    const state = context.pipeline.getState(context.workId);
    // chapterWorkflow：处理当前步骤。
    // getWork：读取当前数据。
    const targetWorkflow =
      operation === "regenerate"
        ? chapterWorkflow(
            context.store.getWork(context.workId)!,
            head.data.chapter,
            context.pipeline.repeatChapters ? "start-next-chapter" : null,
          )
        : null;
    // json：构造 JSON 响应。
    // parse：解析输入。
    // workflowOf：处理当前步骤。
    // failureOf：处理当前步骤。
    // currentRequest：读取当前数据。
    return c.json(
      proseCommandResponseSchema.parse({
        ...context.result,
        workflow: targetWorkflow ?? {
          ...workflowOf(
            state,
            context.pipeline.failureOf(context.workId, state.nextStepId),
            context.pipeline.completionKind,
          ),
          nextStepId: state.nextStepId,
        },
        telemetry: currentRequest()!.telemetry,
      }),
    );
  } catch (cause) {
    // proseResponseError：处理当前步骤。
    throw proseResponseError(context.workId, context.result.command, cause);
  }
}

function proseErrorResponse(c: Context, error: unknown): Response {
  if (!(error instanceof ProseCommandError)) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(
      errorBody("internal-error", "prose response unavailable"),
      500,
    );
  }
  const beforeResponse = error.command.failureStage !== "response";
  const known =
    beforeResponse && error.cause instanceof KnownError
      ? error.cause
      : undefined;
  // proseFailureCode：处理当前步骤。
  const code = proseFailureCode(
    error.cause,
    error.command.failureStage ?? "response",
  );
  // commandValidation：处理当前步骤。
  const validation = beforeResponse ? commandValidation(error.cause, code) : {};
  // json：构造 JSON 响应。
  // parse：解析输入。
  // currentRequest：读取当前数据。
  // commandErrorStatus：处理当前步骤。
  return c.json(
    proseCommandErrorSchema.parse({
      code,
      message: code,
      retryable: known?.retryable ?? false,
      command: error.command,
      telemetry: currentRequest()!.telemetry,
      ...(known?.inputBudget ? { inputBudget: known.inputBudget } : {}),
      ...validation,
    }),
    commandErrorStatus(code, known),
  );
}

async function handleProseCommand(
  c: Context,
  operation: ProseRouteOperation,
  deps: WorksRoutesDeps,
  reject: ProseReject,
): Promise<Response> {
  const headSchema =
    operation === "save" ? proseSaveRequestHeadSchema : proseRequestHeadSchema;
  // 共用请求处理；Prose 差异由下面的适配函数注入。
  // handleCommand：执行当前流程。
  // passthrough：处理当前步骤。
  // proseSchema：处理当前步骤。
  // observeInvalidProse：记录当前观测。
  // executeProseResult：执行当前流程。
  // proseSuccess：处理当前步骤。
  // param：处理当前步骤。
  // proseErrorResponse：处理当前步骤。
  return handleCommand(c, {
    headSchema: headSchema.passthrough(),
    schema: proseSchema(operation),
    reject,
    observeInvalid: (head, parsed, workId) =>
      observeInvalidProse(operation, { data: head }, parsed, workId),
    execute: (data, workId) =>
      executeProseResult(operation, data, workId, deps),
    succeed: (head, result) =>
      proseSuccess(c, operation, { data: head }, {
        workId: c.req.param("id")!,
        result,
        pipeline: deps.pipeline,
        store: deps.store,
      }),
    fail: (error) => proseErrorResponse(c, error),
  });
}

function rejectProseCommand(
  c: Context,
  code: Parameters<ProseReject>[1],
): Response {
  // currentRequest：读取当前数据。
  const scope = currentRequest()!;
  // parse：解析输入。
  // proseOperationFromPath：处理当前步骤。
  // now：读取当前时间。
  const failure = proseCommandErrorSchema.parse({
    code,
    message: code,
    retryable: false,
    command: {
      kind: "request-rejected",
      requestId: scope.requestId,
      operation: proseOperationFromPath(c.req.path),
      executionMode: scope.executionMode,
      latencyMs: Date.now() - scope.startedAt,
      writeOutcome: "not-committed",
      failureStage: "request",
      attemptIds: [],
    },
  });
  // param：处理当前步骤。
  const workId = c.req.param("id");
  if (workId) {
    // recordCommand：写入当前结果。
    recordCommand(workId, failure.command, code);
  }
  // json：构造 JSON 响应。
  return c.json(failure, code === "payload-too-large" ? 413 : 400);
}

function registerProseCommandRoutes(
  app: Hono,
  { store, pipeline, meta }: WorksRoutesDeps,
): void {
  // use：注册中间件。
  // withRequest：处理当前步骤。
  // randomUUID：生成随机 ID。
  app.use("/api/works/:id/artifacts/prose/*", async (_c, next) =>
    withRequest(
      crypto.randomUUID(),
      (meta?.demo ?? true) ? "demo" : "live",
      next,
    ),
  );
  const rejectProseRequest = rejectProseCommand;
  for (const operation of ["approve", "regenerate", "save"] as const) {
    // post：注册 POST 路由。
    // bodyLimit：处理当前步骤。
    // rejectProseRequest：处理当前步骤。
    // handleProseCommand：执行当前流程。
    app.post(
      `/api/works/:id/artifacts/prose/${operation}`,
      bodyLimit({
        maxSize: proseLimits.bodyBytes,
        onError: (c) => rejectProseRequest(c, "payload-too-large"),
      }),
      async (c) =>
        handleProseCommand(
          c,
          operation,
          { store, pipeline },
          rejectProseRequest,
        ),
    );
  }
}

function registerProseRoutes(
  app: Hono,
  { store, pipeline, meta }: WorksRoutesDeps,
): void {
  // registerProseCommandRoutes：处理当前步骤。
  registerProseCommandRoutes(app, { store, pipeline, meta });
  // registerProseOutlineRoute：处理当前步骤。
  registerProseOutlineRoute(app, { store, pipeline });
}

type BeatRouteOperation = "approve" | "regenerate";
type BeatHead = { data: z.infer<typeof beatRequestHeadSchema> };
type BeatReject = (
  c: Context,
  code:
    | "bad-json"
    | "invalid-input"
    | "unsupported-chapter"
    | "payload-too-large",
) => Response;

type CommandStatus = 400 | 404 | 409 | 422 | 500 | 502 | 503 | 504;

type ParsedCommand =
  | { success: true; data: unknown }
  | { success: false; error: z.ZodError };

function invalidCommandFields(parsed: ParsedCommand): boolean {
  if (parsed.success) {
    return false;
  }
  // some：检查任一匹配。
  return parsed.error.issues.some(
    (issue) => issue.path[0] !== "content" && issue.path[0] !== "instructions",
  );
}

function commandErrorStatus(code: string, known?: KnownError): CommandStatus {
  const statuses: Record<string, CommandStatus> = {
    "invalid-content": 422,
    "input-budget-exceeded": 422,
    "work-not-found": 404,
    "artifact-not-found": 404,
    "llm-invalid-output": 502,
    "llm-unavailable": 503,
    "llm-timeout": 504,
  };
  const status = statuses[code];
  if (status) {
    return status;
  }
  return known ? 409 : 500;
}

function commandValidation(cause: unknown, code: string) {
  if (!(cause instanceof z.ZodError) || code !== "invalid-content") {
    return {};
  }
  // formatValidationIssues：格式化当前输出。
  return formatValidationIssues(cause.issues, (issue) =>
    issue.path[0] === "content" || issue.path[0] === "instructions"
      ? issue.path
      : ["content", ...issue.path],
  );
}

type CommandHandlerInput<Head, Data, Result> = {
  headSchema: z.ZodType<Head>;
  schema: z.ZodType<Data>;
  reject: ProseReject;
  observeInvalid: (
    head: Head,
    parsed: { success: false; error: z.ZodError },
    workId: string,
  ) => Promise<void>;
  execute: (data: Data, workId: string) => Promise<Result>;
  succeed: (head: Head, result: Result) => Response;
  fail: (error: unknown) => Response;
};

// 共用请求解析、无效请求观测和响应分派，领域差异由参数注入。
async function handleCommand<Head, Data, Result>(
  c: Context,
  input: CommandHandlerInput<Head, Data, Result>,
): Promise<Response> {
  let body: unknown;
  try {
    // json：构造 JSON 响应。
    body = await c.req.json();
  } catch {
    // reject：拒绝异步调用。
    return input.reject(c, "bad-json");
  }
  // safeParse：校验并解析输入。
  const head = input.headSchema.safeParse(body);
  if (!head.success) {
    // some：检查任一匹配。
    const unsupported = head.error.issues.some(
      (issue) => issue.path[0] === "chapter",
    );
    // reject：拒绝异步调用。
    return input.reject(
      c,
      unsupported ? "unsupported-chapter" : "invalid-input",
    );
  }
  // safeParse：校验并解析输入。
  const parsed = input.schema.safeParse(body);
  // invalidCommandFields：处理当前步骤。
  if (invalidCommandFields(parsed)) {
    // reject：拒绝异步调用。
    return input.reject(c, "invalid-input");
  }
  // param：处理当前步骤。
  const workId = c.req.param("id")!;
  try {
    if (!parsed.success) {
      // observeInvalid：记录当前观测。
      await input.observeInvalid(head.data, parsed, workId);
      throw new Error("unreachable");
    }
    // execute：执行当前流程。
    const result = await input.execute(parsed.data, workId);
    // succeed：处理当前步骤。
    return input.succeed(head.data, result);
  } catch (error) {
    // fail：处理当前步骤。
    return input.fail(error);
  }
}

function beatSchema(operation: BeatRouteOperation) {
  if (operation === "approve") {
    return beatApproveRequestSchema;
  }
  return beatRegenerateRequestSchema;
}

async function executeBeatResult(
  operation: BeatRouteOperation,
  data: unknown,
  workId: string,
  deps: WorksRoutesDeps,
) {
  if (operation === "approve") {
    // approveBeat：处理当前步骤。
    // parse：解析输入。
    return approveBeat(
      deps.store,
      workId,
      beatApproveRequestSchema.parse(data),
    );
  }
  // regenerateBeat：处理当前步骤。
  // parse：解析输入。
  return deps.pipeline.regenerateBeat(
    workId,
    beatRegenerateRequestSchema.parse(data),
  );
}

async function observeInvalidBeat(
  operation: BeatRouteOperation,
  head: BeatHead,
  parsed: { success: false; error: z.ZodError },
  workId: string,
): Promise<void> {
  // observeBeat：记录当前观测。
  await observeBeat(
    { workId, chapter: head.data.chapter },
    operation === "approve" ? "approve-beat" : "regenerate-beat",
    {
      artifactId: head.data.expectedArtifactId,
      version: head.data.expectedHeadVersion,
    },
    (execution) => {
      // enter：标记执行阶段。
      execution.enter("input");
      throw parsed.error;
    },
  );
}

function beatSuccess(
  c: Context,
  operation: BeatRouteOperation,
  head: BeatHead,
  context: {
    workId: string;
    result: Awaited<ReturnType<typeof executeBeatResult>>;
    pipeline: Pipeline;
    store: WorkStore;
  },
): Response {
  // getState：读取当前数据。
  const state = context.pipeline.getState(context.workId);
  // chapterWorkflow：处理当前步骤。
  // getWork：读取当前数据。
  const targetWorkflow =
    operation === "regenerate"
      ? chapterWorkflow(
          context.store.getWork(context.workId)!,
          head.data.chapter,
          context.pipeline.repeatChapters ? "start-next-chapter" : null,
        )
      : null;
  // json：构造 JSON 响应。
  // parse：解析输入。
  // workflowOf：处理当前步骤。
  // failureOf：处理当前步骤。
  // currentRequest：读取当前数据。
  return c.json(
    beatCommandResponseSchema.parse({
      ...context.result,
      workflow: targetWorkflow ?? {
        ...workflowOf(
          state,
          context.pipeline.failureOf(context.workId, state.nextStepId),
          context.pipeline.completionKind,
        ),
        nextStepId: state.nextStepId,
      },
      telemetry: currentRequest()!.telemetry,
    }),
  );
}

function beatErrorResponse(c: Context, error: unknown): Response {
  if (!(error instanceof BeatCommandError)) {
    // json：构造 JSON 响应。
    // errorBody：处理当前步骤。
    return c.json(
      errorBody("internal-error", "beat response unavailable"),
      500,
    );
  }
  const known = error.cause instanceof KnownError ? error.cause : undefined;
  // beatFailureCode：处理当前步骤。
  const code = beatFailureCode(
    error.cause,
    error.command.failureStage ?? "response",
  );
  // json：构造 JSON 响应。
  // parse：解析输入。
  // currentRequest：读取当前数据。
  // commandValidation：处理当前步骤。
  // commandErrorStatus：处理当前步骤。
  return c.json(
    beatCommandErrorSchema.parse({
      code,
      message: code,
      retryable: known?.retryable ?? false,
      command: error.command,
      telemetry: currentRequest()!.telemetry,
      ...(known?.inputBudget ? { inputBudget: known.inputBudget } : {}),
      ...commandValidation(error.cause, code),
    }),
    commandErrorStatus(code, known),
  );
}

async function handleBeatCommand(
  c: Context,
  operation: BeatRouteOperation,
  deps: WorksRoutesDeps,
  reject: BeatReject,
): Promise<Response> {
  // 共用请求处理；Beat 差异由下面的适配函数注入。
  // handleCommand：执行当前流程。
  // passthrough：处理当前步骤。
  // beatSchema：处理当前步骤。
  // observeInvalidBeat：记录当前观测。
  // executeBeatResult：执行当前流程。
  // beatSuccess：处理当前步骤。
  // param：处理当前步骤。
  // beatErrorResponse：处理当前步骤。
  return handleCommand(c, {
    headSchema: beatRequestHeadSchema.passthrough(),
    schema: beatSchema(operation),
    reject,
    observeInvalid: (head, parsed, workId) =>
      observeInvalidBeat(operation, { data: head }, parsed, workId),
    execute: (data, workId) =>
      executeBeatResult(operation, data, workId, deps),
    succeed: (head, result) =>
      beatSuccess(c, operation, { data: head }, {
        workId: c.req.param("id")!,
        result,
        pipeline: deps.pipeline,
        store: deps.store,
      }),
    fail: (error) => beatErrorResponse(c, error),
  });
}

function rejectBeatCommand(
  c: Context,
  code: Parameters<BeatReject>[1],
): Response {
  // currentRequest：读取当前数据。
  const scope = currentRequest()!;
  // parse：解析输入。
  // endsWith：处理当前步骤。
  // now：读取当前时间。
  const failure = beatCommandErrorSchema.parse({
    code,
    message: code,
    retryable: false,
    command: {
      kind: "request-rejected",
      requestId: scope.requestId,
      operation: c.req.path.endsWith("/regenerate")
        ? "regenerate-beat"
        : "approve-beat",
      executionMode: scope.executionMode,
      latencyMs: Date.now() - scope.startedAt,
      writeOutcome: "not-committed",
      failureStage: "request",
      attemptIds: [],
    },
  });
  // param：处理当前步骤。
  const workId = c.req.param("id");
  if (workId) {
    // recordCommand：写入当前结果。
    recordCommand(workId, failure.command, code);
  }
  // json：构造 JSON 响应。
  return c.json(failure, code === "payload-too-large" ? 413 : 400);
}

function registerBeatCommandRoutes(
  app: Hono,
  { store, pipeline, meta }: WorksRoutesDeps,
): void {
  // use：注册中间件。
  // withRequest：处理当前步骤。
  // randomUUID：生成随机 ID。
  app.use("/api/works/:id/artifacts/beat/*", async (_c, next) =>
    withRequest(
      crypto.randomUUID(),
      (meta?.demo ?? true) ? "demo" : "live",
      next,
    ),
  );
  const rejectBeatRequest = rejectBeatCommand;
  for (const operation of ["approve", "regenerate"] as const) {
    // post：注册 POST 路由。
    // bodyLimit：处理当前步骤。
    // rejectBeatRequest：处理当前步骤。
    // handleBeatCommand：执行当前流程。
    app.post(
      `/api/works/:id/artifacts/beat/${operation}`,
      bodyLimit({
        maxSize: beatLimits.bodyBytes,
        onError: (c) => rejectBeatRequest(c, "payload-too-large"),
      }),
      async (c) =>
        handleBeatCommand(c, operation, { store, pipeline }, rejectBeatRequest),
    );
  }
}

function registerBeatRoutes(
  app: Hono,
  { store, pipeline, meta }: WorksRoutesDeps,
): void {
  // registerBeatCommandRoutes：处理当前步骤。
  registerBeatCommandRoutes(app, { store, pipeline, meta });
  // registerBeatVariantRoute：处理当前步骤。
  registerBeatVariantRoute(app, { store, pipeline });
}

function registerApprovalRoute(app: Hono, { pipeline }: WorksRoutesDeps): void {
  // post：注册 POST 路由。
  app.post("/api/works/:id/approve", async (c) => {
    // readJsonBody：读取当前数据。
    const body = await readJsonBody(c);
    if (!body.ok) {
      return body.response;
    }
    // safeParse：校验并解析输入。
    const parsed = approveRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      // invalidFields：处理当前步骤。
      return c.json(
        {
          ...errorBody("invalid-input", "invalid input"),
          issues: invalidFields(parsed.error),
        },
        400,
      );
    }
    // creative 的「通过」只能走 select(恰好 1 方向);通用 approve 对它关闭
    if (parsed.data.kind === "creative") {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(
        errorBody(
          "direction-not-selected",
          "creative must be approved via POST .../artifacts/creative/select",
        ),
        409,
      );
    }
    try {
      // param：处理当前步骤。
      const workId = c.req.param("id");
      // approve：处理当前步骤。
      pipeline.approve(workId, parsed.data.kind, parsed.data.chapter);
      // contractJson：处理当前步骤。
      // getState：读取当前数据。
      return contractJson(c, pipelineStateSchema, pipeline.getState(workId));
    } catch (err) {
      // routeError：处理当前步骤。
      return routeError(c, err);
    }
  });
}

export function worksRoutes({ store, pipeline, meta }: WorksRoutesDeps): Hono {
  const app = new Hono();
  // onError：处理当前步骤。
  // responseUnavailable：处理当前步骤。
  app.onError((_error, c) => responseUnavailable(c));
  // use：注册中间件。
  app.use("*", async (c, next) => {
    // next：处理当前步骤。
    await next();
    if (c.res.status < 400) {
      return;
    }
    // catch：处理异步失败。
    // json：构造 JSON 响应。
    // clone：处理当前步骤。
    const body: unknown = await c.res
      .clone()
      .json()
      .catch(() => null);
    // safeParse：校验并解析输入。
    if (!httpErrorSchema.safeParse(body).success) {
      // responseUnavailable：处理当前步骤。
      return responseUnavailable(c);
    }
  });

  // registerHistoryRoutes：处理当前步骤。
  registerHistoryRoutes(app, store);
  // registerBeatRoutes：处理当前步骤。
  registerBeatRoutes(app, { store, pipeline, meta });
  // registerProseRoutes：处理当前步骤。
  registerProseRoutes(app, { store, pipeline, meta });
  // registerCreativeOperations：处理当前步骤。
  registerCreativeOperations(app, { store, pipeline, meta });
  // registerWorkReadRoutes：处理当前步骤。
  registerWorkReadRoutes(app, { store, pipeline });
  // registerCreativeRoutes：处理当前步骤。
  registerCreativeRoutes(app, store);
  // registerOutlineRoutes：处理当前步骤。
  registerOutlineRoutes(app, store);
  // registerAdvanceRoutes：处理当前步骤。
  registerAdvanceRoutes(app, { store, pipeline, meta });
  return app;
}

function registerTelemetryRoute(app: Hono, store: WorkStore): void {
  // LLM 遥测查询口(#14):回看某作品的全部 callLlm 记录(进程内账本,随进程生命周期)
  // get：读取值。
  app.get("/api/works/:id/telemetry", (c) => {
    // param：处理当前步骤。
    const workId = c.req.param("id");
    // getWork：读取当前数据。
    if (!store.getWork(workId)) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(errorBody("work-not-found", "not found"), 404);
    }
    // queries：处理当前步骤。
    const raw = c.req.queries();
    // some：检查任一匹配。
    // values：处理当前步骤。
    if (Object.values(raw).some((values) => values.length !== 1)) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(
        errorBody("invalid-input", "invalid diagnostic query"),
        400,
      );
    }
    // safeParse：校验并解析输入。
    // query：处理当前步骤。
    const query = diagnosticQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      // json：构造 JSON 响应。
      // errorBody：处理当前步骤。
      return c.json(
        errorBody("invalid-input", "invalid diagnostic query"),
        400,
      );
    }
    // contractJson：处理当前步骤。
    // diagnosticsFor：处理当前步骤。
    return contractJson(
      c,
      diagnosticResponseSchema,
      diagnosticsFor(workId, query.data),
    );
  });
}

function chapterStartError(
  c: Context,
  error: unknown,
  telemetry: LlmTelemetry[],
): Response {
  if (error instanceof BeatCommandError) {
    // json：构造 JSON 响应。
    // parse：解析输入。
    return c.json(
      beatCommandErrorSchema.parse({
        code: "internal-error",
        message: "internal-error",
        retryable: false,
        command: error.command,
        telemetry,
      }),
      500,
    );
  }
  if (error instanceof KnownError) {
    // routeError：处理当前步骤。
    return routeError(c, error);
  }
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  return c.json(
    errorBody("internal-error", "chapter response unavailable"),
    500,
  );
}

function advanceError(
  c: Context,
  error: unknown,
  context: { requestId: string; workId: string; telemetry: LlmTelemetry[] },
): Response {
  if (error instanceof BeatCommandError) {
    // json：构造 JSON 响应。
    // parse：解析输入。
    return c.json(
      beatCommandErrorSchema.parse({
        code: "internal-error",
        message: "internal-error",
        retryable: false,
        command: error.command,
        telemetry: context.telemetry,
      }),
      500,
    );
  }
  if (error instanceof ProseCommandError) {
    // json：构造 JSON 响应。
    // parse：解析输入。
    return c.json(
      proseCommandErrorSchema.parse({
        code: "internal-error",
        message: "internal-error",
        retryable: false,
        command: error.command,
        telemetry: context.telemetry,
      }),
      500,
    );
  }
  if (error instanceof KnownError && error.code === "advance-in-progress") {
    // safeLog：处理当前步骤。
    safeLog({
      event: "pipeline.lock-conflict",
      requestId: context.requestId,
      workId: context.workId,
    });
  }
  // routeError：处理当前步骤。
  return routeError(c, error);
}

async function executeChapterStart(
  c: Context,
  pipeline: Pipeline,
  meta: WorksRoutesDeps["meta"],
  request: z.infer<typeof startChapterRequestSchema>,
): Promise<Response> {
  // randomUUID：生成随机 ID。
  const requestId = crypto.randomUUID();
  let telemetry: LlmTelemetry[] = [];
  try {
    // withRequest：处理当前步骤。
    const outcome = await withRequest(
      requestId,
      (meta?.demo ?? true) ? "demo" : "live",
      (scope) => {
        telemetry = scope.telemetry;
        // startChapter：执行当前流程。
        // param：处理当前步骤。
        return pipeline.startChapter(c.req.param("id")!, request);
      },
    );
    // safeLog：处理当前步骤。
    // param：处理当前步骤。
    safeLog({
      event: "pipeline.start-chapter",
      requestId,
      workId: c.req.param("id"),
      chapter: request.chapter,
      outcome: outcome.kind,
    });
    // contractJson：处理当前步骤。
    return contractJson(c, advanceOutcomeDtoSchema, {
      ...outcome,
      telemetry,
    });
  } catch (error) {
    // chapterStartError：处理当前步骤。
    return chapterStartError(c, error, telemetry);
  }
}

function registerChapterStartRoute(
  app: Hono,
  { pipeline, meta }: WorksRoutesDeps,
): void {
  // post：注册 POST 路由。
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  // errorBody：处理当前步骤。
  app.post(
    "/api/works/:id/chapters/start",
    bodyLimit({
      maxSize: 4096,
      onError: (c) =>
        c.json(
          errorBody("payload-too-large", "chapter request exceeds body limit"),
          413,
        ),
    }),
    async (c) => {
      // readJsonBody：读取当前数据。
      const body = await readJsonBody(c);
      if (!body.ok) {
        return body.response;
      }
      // safeParse：校验并解析输入。
      const parsed = startChapterRequestSchema.safeParse(body.data);
      if (!parsed.success) {
        // json：构造 JSON 响应。
        // errorBody：处理当前步骤。
        return c.json(
          errorBody("invalid-input", "invalid chapter start request"),
          400,
        );
      }
      // executeChapterStart：执行当前流程。
      return executeChapterStart(c, pipeline, meta, parsed.data);
    },
  );
}

function registerAdvanceRoute(
  app: Hono,
  { pipeline, meta }: WorksRoutesDeps,
): void {
  // advance = 推进到下一个关卡(链式);返回可穷举 outcome。
  // #14:响应内联本次推进期间的 LLM 遥测(账本 cursor 前后差集),Agent 一次调用拿到完整观测
  // post：注册 POST 路由。
  app.post("/api/works/:id/advance", async (c) => {
    // param：处理当前步骤。
    const workId = c.req.param("id");
    // randomUUID：生成随机 ID。
    const requestId = crypto.randomUUID();
    // now：读取当前时间。
    const started = Date.now();
    let telemetry: LlmTelemetry[] = [];
    try {
      // withRequest：处理当前步骤。
      const outcome = await withRequest(
        requestId,
        (meta?.demo ?? true) ? "demo" : "live",
        (scope) => {
          telemetry = scope.telemetry;
          // advance：执行当前流程。
          return pipeline.advance(workId);
        },
      );
      // safeLog：处理当前步骤。
      // now：读取当前时间。
      safeLog({
        event: "pipeline.advance",
        requestId,
        workId,
        outcome: outcome.kind,
        latencyMs: Date.now() - started,
      });
      // contractJson：处理当前步骤。
      return contractJson(c, advanceOutcomeDtoSchema, {
        ...outcome,
        telemetry,
      });
    } catch (err) {
      // advanceError：执行当前流程。
      return advanceError(c, err, { requestId, workId, telemetry });
    }
  });
}

function registerAdvanceRoutes(
  app: Hono,
  { store, pipeline, meta }: WorksRoutesDeps,
): void {
  // registerAdvanceRoute：处理当前步骤。
  registerAdvanceRoute(app, { store, pipeline, meta });
  // registerChapterStartRoute：处理当前步骤。
  registerChapterStartRoute(app, { store, pipeline, meta });
  // registerTelemetryRoute：处理当前步骤。
  registerTelemetryRoute(app, store);
  // registerApprovalRoute：处理当前步骤。
  registerApprovalRoute(app, { store, pipeline });
}
