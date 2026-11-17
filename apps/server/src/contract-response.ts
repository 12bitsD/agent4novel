import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

// Response validation happens after the operation; failure cannot prove a
// write was rejected.
export function contractJson(
  c: Context,
  schema: z.ZodTypeAny,
  body: unknown,
  status: ContentfulStatusCode = 200,
): Response {
  // safeParse：校验并解析输入。
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // responseUnavailable：处理当前步骤。
    return responseUnavailable(c);
  }
  // json：构造 JSON 响应。
  return c.json(parsed.data, status);
}

export function responseUnavailable(c: Context): Response {
  // json：构造 JSON 响应。
  return c.json(
    {
      code: "internal-error",
      message: "response unavailable",
      retryable: false,
    },
    500,
  );
}
