import { Hono } from "hono";
import type { Context } from "hono";
import {
  apiErrorSchema,
  settingLimits,
  settingExtensionActionRequestSchema,
  settingExtensionProposeRequestSchema,
  settingExtensionReceiptSchema,
  settingExtensionResourceSchema,
  settingExtensionPathSchema as pathSchema,
  settingExtensionActionPathSchema as actionPathSchema,
} from "@agent4novel/contracts";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { contractJson, responseUnavailable } from "../contract-response.js";
import { KnownError } from "../errors.js";
import type { WorkStore } from "../store/work-store.js";
import { formatValidationIssues } from "./validation-issues.js";

const statuses: Record<string, ContentfulStatusCode> = {
  "invalid-input": 400,
  "work-not-found": 404,
  "setting-extension-not-found": 404,
  "setting-extension-base-conflict": 409,
  "setting-extension-request-conflict": 409,
  "setting-extension-stale": 409,
  "setting-extension-chapter-pending": 409,
  "setting-extension-state-conflict": 409,
  "setting-extension-limit": 422,
  "setting-extension-invalid": 422,
};
const invalid = {
  code: "invalid-input",
  message: "invalid setting extension request",
  retryable: false,
};

type Operation = "propose" | "approve" | "cancel";
type BodyResult =
  | { ok: true; data: unknown }
  | { ok: false; response: Response };

function extensionError(c: Context, error: unknown): Response {
  if (error instanceof KnownError && statuses[error.code]) {
    // contractJson：处理当前步骤。
    return contractJson(
      c,
      apiErrorSchema,
      { code: error.code, message: error.code, retryable: false },
      statuses[error.code],
    );
  }
  // responseUnavailable：处理当前步骤。
  return responseUnavailable(c);
}

async function boundedJson(c: Context): Promise<BodyResult> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  // getReader：读取当前数据。
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    try {
      while (true) {
        // read：读取当前数据。
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > settingLimits.bodyBytes) {
          // catch：处理异步失败。
          // cancel：处理当前步骤。
          void reader.cancel().catch(() => {});
          // contractJson：处理当前步骤。
          return {
            ok: false,
            response: contractJson(
              c,
              apiErrorSchema,
              {
                code: "payload-too-large",
                message: "setting extension body exceeds limit",
                retryable: false,
              },
              413,
            ),
          };
        }
        // push：追加元素。
        chunks.push(value);
      }
    } finally {
      // releaseLock：处理当前步骤。
      reader.releaseLock();
    }
  }
  try {
    // parse：解析输入。
    // toString：转换当前数据。
    // concat：处理当前步骤。
    return {
      ok: true,
      data: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
  } catch (error) {
    void error;
    // contractJson：处理当前步骤。
    return {
      ok: false,
      response: contractJson(c, apiErrorSchema, invalid, 400),
    };
  }
}

function invalidExtension(
  c: Context,
  operation: Operation,
  error: Parameters<typeof formatValidationIssues>[0],
): Response {
  // every：检查全部匹配。
  const logicalLimit =
    operation === "propose" &&
    error.every((issue) => issue.path[0] === "extension" && issue.code === "too_big");
  // contractJson：处理当前步骤。
  // formatValidationIssues：格式化当前输出。
  return contractJson(
    c,
    apiErrorSchema,
    {
      ...invalid,
      ...(logicalLimit
        ? {
            code: "setting-extension-limit",
            message: "setting extension exceeds logical limits",
          }
        : {}),
      ...formatValidationIssues(error),
    },
    logicalLimit ? 422 : 400,
  );
}

function executeExtension(
  store: WorkStore,
  operation: Operation,
  workId: string,
  data: unknown,
) {
  if (operation === "propose") {
    // proposeSettingExtension：处理当前步骤。
    // parse：解析输入。
    return store.proposeSettingExtension(
      workId,
      settingExtensionProposeRequestSchema.parse(data),
    );
  }
  if (operation === "approve") {
    // approveSettingExtension：处理当前步骤。
    // parse：解析输入。
    return store.approveSettingExtension(
      workId,
      settingExtensionActionRequestSchema.parse(data),
    );
  }
  // cancelSettingExtension：处理当前步骤。
  // parse：解析输入。
  return store.cancelSettingExtension(
    workId,
    settingExtensionActionRequestSchema.parse(data),
  );
}

function actionPathFor(c: Context, operation: Operation) {
  if (operation === "propose") {
    return null;
  }
  // safeParse：校验并解析输入。
  // param：处理当前步骤。
  // param：处理当前步骤。
  return actionPathSchema.safeParse({
    workId: c.req.param("id"),
    requestId: c.req.param("requestId"),
  });
}

function schemaForOperation(operation: Operation) {
  if (operation === "propose") {
    return settingExtensionProposeRequestSchema;
  }
  return settingExtensionActionRequestSchema;
}

async function postExtension(
  c: Context,
  store: WorkStore,
  operation: Operation,
): Promise<Response> {
  // param：处理当前步骤。
  const workId = c.req.param("id")!;
  // actionPathFor：处理当前步骤。
  const actionPath = actionPathFor(c, operation);
  if (actionPath && !actionPath.success) {
    // contractJson：处理当前步骤。
    return contractJson(c, apiErrorSchema, invalid, 400);
  }
  // boundedJson：处理当前步骤。
  const body = await boundedJson(c);
  if (!body.ok) {
    return body.response;
  }
  // schemaForOperation：处理当前步骤。
  const schema = schemaForOperation(operation);
  // safeParse：校验并解析输入。
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    // invalidExtension：处理当前步骤。
    return invalidExtension(c, operation, parsed.error.issues);
  }
  if (actionPath && actionPath.data.requestId !== parsed.data.requestId) {
    // contractJson：处理当前步骤。
    return contractJson(c, apiErrorSchema, invalid, 400);
  }
  try {
    // executeExtension：执行当前流程。
    const receipt = executeExtension(store, operation, workId, parsed.data);
    // contractJson：处理当前步骤。
    return contractJson(
      c,
      settingExtensionReceiptSchema,
      receipt,
      operation === "propose" ? 201 : 200,
    );
  } catch (error) {
    // extensionError：处理当前步骤。
    return extensionError(c, error);
  }
}

export function settingExtensionRoutes(store: WorkStore): Hono {
  const app = new Hono();
  // onError：处理当前步骤。
  // responseUnavailable：处理当前步骤。
  app.onError((_error, c) => responseUnavailable(c));
  // get：读取值。
  app.get("/api/works/:id/setting-extensions/:requestId", (c) => {
    // safeParse：校验并解析输入。
    // param：处理当前步骤。
    // param：处理当前步骤。
    const path = pathSchema.safeParse({
      workId: c.req.param("id"),
      requestId: c.req.param("requestId"),
    });
    if (!path.success) {
      // contractJson：处理当前步骤。
      return contractJson(c, apiErrorSchema, invalid, 400);
    }
    try {
      // contractJson：处理当前步骤。
      // getSettingExtension：读取当前数据。
      return contractJson(
        c,
        settingExtensionResourceSchema,
        store.getSettingExtension(path.data.workId, path.data.requestId),
      );
    } catch (error) {
      // extensionError：处理当前步骤。
      return extensionError(c, error);
    }
  });
  const paths = {
    propose: "/api/works/:id/setting-extensions",
    approve: "/api/works/:id/setting-extensions/:requestId/approve",
    cancel: "/api/works/:id/setting-extensions/:requestId/cancel",
  } as const;
  for (const operation of ["propose", "approve", "cancel"] as const) {
    // post：注册 POST 路由。
    // postExtension：处理当前步骤。
    app.post(paths[operation], (c) => postExtension(c, store, operation));
  }
  return app;
}
