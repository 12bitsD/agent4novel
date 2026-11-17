import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  badExampleLimits,
  badExampleQuerySchema,
  badExampleSchema,
  badExamplePageSchema,
} from "@agent4novel/contracts";
import type { BadExampleRepository } from "../bad-examples/repository.js";
import { KnownError } from "../errors.js";
import { contractJson, responseUnavailable } from "../contract-response.js";

function badExampleError(
  c: Parameters<typeof responseUnavailable>[0],
  error: unknown,
) {
  if (!(error instanceof KnownError)) {
    // responseUnavailable：处理当前步骤。
    return responseUnavailable(c);
  }
  let status: 400 | 404 | 409 = 400;
  if (error.code === "version-conflict") {
    status = 409;
  } else   // includes：检查包含关系。
  if (["work-not-found", "bad-example-not-found"].includes(error.code)) {
    status = 404;
  }
  // json：构造 JSON 响应。
  return c.json(
    { code: error.code, message: error.message, retryable: false },
    status,
  );
}

async function badExampleBody(c: Parameters<typeof responseUnavailable>[0]) {
  try {
    // parse：解析输入。
    // decode：处理当前步骤。
    // arrayBuffer：处理当前步骤。
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await c.req.arrayBuffer(),
      ),
    ) as Parameters<BadExampleRepository["markBadExample"]>[1];
  } catch {
    throw new KnownError("bad-example-invalid", "invalid selection request");
  }
}

function badExampleQuery(c: Parameters<typeof responseUnavailable>[0]) {
  const params = new URL(c.req.url).searchParams;
  const values: Record<string, number> = {};
  for (const [key, value] of params) {
    // includes：检查包含关系。
    // getAll：读取当前数据。
    // test：处理当前步骤。
    if (
      !["chapter", "after"].includes(key) ||
      params.getAll(key).length !== 1 ||
      !/^[1-9][0-9]*$/.test(value)
    ) {
      throw new KnownError("bad-example-invalid", "invalid selection query");
    }
    // Number：转换数值。
    values[key] = Number(value);
  }
  // safeParse：校验并解析输入。
  const query = badExampleQuerySchema.safeParse(values);
  if (!query.success) {
    throw new KnownError("bad-example-invalid", "invalid selection query");
  }
  return query.data;
}

export function badExampleRoutes(repository: BadExampleRepository) {
  const app = new Hono(),
    base = "/api/works/:id/bad-examples";
  // use：注册中间件。
  // bodyLimit：处理当前步骤。
  // json：构造 JSON 响应。
  app.use(
    base,
    bodyLimit({
      maxSize: badExampleLimits.requestBytes,
      onError: (c) =>
        c.json(
          {
            code: "payload-too-large",
            message: "selection request exceeds byte limit",
            retryable: false,
          },
          413,
        ),
    }),
  );
  // onError：处理当前步骤。
  // badExampleError：处理当前步骤。
  app.onError((error, c) => badExampleError(c, error));
  // post：注册 POST 路由。
  app.post(base, async (c) => {
    // badExampleBody：处理当前步骤。
    const input = await badExampleBody(c);
    // contractJson：处理当前步骤。
    // markBadExample：写入当前结果。
    // param：处理当前步骤。
    return contractJson(
      c,
      badExampleSchema,
      repository.markBadExample(c.req.param("id"), input),
    );
  });
  // get：读取值。
  app.get(base, (c) => {
    // badExampleQuery：处理当前步骤。
    const query = badExampleQuery(c);
    // contractJson：处理当前步骤。
    // listBadExamples：读取当前数据。
    // param：处理当前步骤。
    return contractJson(
      c,
      badExamplePageSchema,
      repository.listBadExamples(c.req.param("id"), query),
    );
  });
  // get：读取值。
  app.get(`${base}/:sampleId`, (c) => {
    // getBadExample：读取当前数据。
    // param：处理当前步骤。
    // param：处理当前步骤。
    const record = repository.getBadExample(
      c.req.param("id"),
      c.req.param("sampleId"),
    );
    if (!record) {
      throw new KnownError("bad-example-not-found", "bad example not found");
    }
    // contractJson：处理当前步骤。
    return contractJson(c, badExampleSchema, record);
  });
  return app;
}
