import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  agentFileSchema,
  agentFileReadSchema,
  authorConfigReceiptSchema,
  authorConfigViewSchema,
} from "@agent4novel/contracts";
import type { AgentFileUpload, AuthorConfigSave } from "@agent4novel/contracts";
import type { AuthorConfigService } from "../config/author-config-service.js";
import { KnownError } from "../errors.js";
import { contractJson, responseUnavailable } from "../contract-response.js";

function configError(c: Context, error: unknown): Response {
  if (!(error instanceof KnownError)) {
    // responseUnavailable：处理当前步骤。
    return responseUnavailable(c);
  }
  let status: 400 | 404 | 409 = 400;
  if (error.code === "version-conflict") {
    status = 409;
  } else if (
    error.code === "work-not-found" ||
    error.code === "agent-file-unavailable"
  ) {
    status = 404;
  }
  // json：构造 JSON 响应。
  return c.json(
    { code: error.code, message: error.message, retryable: false },
    status,
  );
}

async function body(c: Context) {
  try {
    // parse：解析输入。
    // decode：处理当前步骤。
    // arrayBuffer：处理当前步骤。
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await c.req.arrayBuffer(),
      ),
    );
  } catch {
    throw new KnownError("config-invalid", "invalid configuration request");
  }
}

export function authorConfigRoutes(service: AuthorConfigService) {
  const app = new Hono();
  const base = "/api/works/:id";
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  const limit = bodyLimit({
    maxSize: 196_608,
    onError: (c) =>
      c.json(
        {
          code: "payload-too-large",
          message: "configuration request exceeds byte limit",
          retryable: false,
        },
        413,
      ),
  });
  // use：注册中间件。
  app.use(`${base}/agent-config`, limit);
  // use：注册中间件。
  app.use(`${base}/agent-files`, limit);
  // onError：处理当前步骤。
  // configError：处理当前步骤。
  app.onError((error, c) => configError(c, error));
  // get：读取值。
  // contractJson：处理当前步骤。
  // get：读取值。
  // param：处理当前步骤。
  app.get(`${base}/agent-config`, (c) =>
    contractJson(c, authorConfigViewSchema, service.get(c.req.param("id"))),
  );
  // put：注册 PUT 路由。
  // contractJson：处理当前步骤。
  // save：写入当前结果。
  // param：处理当前步骤。
  // body：处理当前步骤。
  app.put(`${base}/agent-config`, async (c) =>
    contractJson(
      c,
      authorConfigReceiptSchema,
      service.save(c.req.param("id"), (await body(c)) as AuthorConfigSave),
    ),
  );
  // post：注册 POST 路由。
  // contractJson：处理当前步骤。
  // upload：处理当前步骤。
  // param：处理当前步骤。
  // body：处理当前步骤。
  app.post(`${base}/agent-files`, async (c) =>
    contractJson(
      c,
      agentFileSchema,
      service.upload(c.req.param("id"), (await body(c)) as AgentFileUpload),
    ),
  );
  // get：读取值。
  // contractJson：处理当前步骤。
  // readFile：读取当前数据。
  // param：处理当前步骤。
  // param：处理当前步骤。
  app.get(`${base}/agent-files/:fileId`, (c) =>
    contractJson(
      c,
      agentFileReadSchema,
      service.readFile(c.req.param("id"), c.req.param("fileId")),
    ),
  );
  return app;
}
