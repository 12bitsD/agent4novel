import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'

// Response validation happens after the operation; failure cannot prove a write was rejected.
export function contractJson(c: Context, schema: z.ZodTypeAny, body: unknown, status: ContentfulStatusCode = 200): Response {
  const parsed = schema.safeParse(body)
  if (!parsed.success) return responseUnavailable(c)
  return c.json(parsed.data, status)
}

export function responseUnavailable(c: Context): Response {
  return c.json({ code: 'internal-error', message: 'response unavailable', retryable: false }, 500)
}
