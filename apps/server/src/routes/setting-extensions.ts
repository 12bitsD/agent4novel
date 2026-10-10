import { Hono } from 'hono'
import { z } from 'zod'
import {
  apiErrorSchema, settingLimits, settingExtensionActionRequestSchema, settingExtensionProposeRequestSchema,
  settingExtensionReceiptSchema, settingExtensionResourceSchema,
} from '@agent4novel/contracts'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { contractJson, responseUnavailable } from '../contract-response.js'
import { KnownError } from '../errors.js'
import type { WorkStore } from '../store/work-store.js'

const statuses: Record<string, ContentfulStatusCode> = {
  'invalid-input': 400, 'work-not-found': 404, 'setting-extension-not-found': 404,
  'setting-extension-base-conflict': 409, 'setting-extension-request-conflict': 409,
  'setting-extension-stale': 409, 'setting-extension-chapter-pending': 409,
  'setting-extension-state-conflict': 409, 'setting-extension-limit': 422, 'setting-extension-invalid': 422,
}
const invalid = { code: 'invalid-input', message: 'invalid setting extension request', retryable: false }
const pathSchema = z.object({ workId: z.string().min(1), requestId: z.string().uuid() }).strict()
const actionPathSchema = pathSchema

export function settingExtensionRoutes(store: WorkStore): Hono {
  const app = new Hono()
  app.onError((_error, c) => responseUnavailable(c))
  app.get('/api/works/:id/setting-extensions/:requestId', c => {
    const path = pathSchema.safeParse({ workId: c.req.param('id'), requestId: c.req.param('requestId') })
    if (!path.success) return contractJson(c, apiErrorSchema, invalid, 400)
    try { return contractJson(c, settingExtensionResourceSchema, store.getSettingExtension(path.data.workId, path.data.requestId)) }
    catch (error) {
      if (error instanceof KnownError && statuses[error.code]) return contractJson(c, apiErrorSchema,
        { code: error.code, message: error.code, retryable: false }, statuses[error.code])
      return responseUnavailable(c)
    }
  })
  const paths = {
    propose: '/api/works/:id/setting-extensions',
    approve: '/api/works/:id/setting-extensions/:requestId/approve',
    cancel: '/api/works/:id/setting-extensions/:requestId/cancel',
  } as const
  for (const operation of ['propose', 'approve', 'cancel'] as const) app.post(paths[operation], async c => {
    const workId = c.req.param('id')
    // Validate action path syntax before reading any proposal state. This keeps
    // malformed/unknown paths from being masked by a later lookup error.
    const actionPath = operation === 'propose' ? null
      : actionPathSchema.safeParse({ workId, requestId: c.req.param('requestId') })
    if (actionPath && !actionPath.success) return contractJson(c, apiErrorSchema, invalid, 400)
    // Measure the actual byte stream, not a claimed Content-Length. Stop before
    // parsing JSON and bound allocation even for chunked/incorrectly labelled bodies.
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = c.req.raw.body?.getReader()
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > settingLimits.bodyBytes) {
            void reader.cancel().catch(() => {})
            return contractJson(c, apiErrorSchema, { code: 'payload-too-large', message: 'setting extension body exceeds limit', retryable: false }, 413)
          }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
    }
    let body: unknown
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { return contractJson(c, apiErrorSchema, invalid, 400) }
    const schema = operation === 'propose' ? settingExtensionProposeRequestSchema : settingExtensionActionRequestSchema
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      const logicalLimit = operation === 'propose' && parsed.error.issues.every(issue => issue.path[0] === 'extension' && issue.code === 'too_big')
      return contractJson(c, apiErrorSchema, { ...invalid,
        ...(logicalLimit ? { code: 'setting-extension-limit', message: 'setting extension exceeds logical limits' } : {}),
        issues: parsed.error.issues.slice(0, 128).map(({ path, code }) => ({ path, code, message: 'invalid field' })) }, logicalLimit ? 422 : 400)
    }
    if (actionPath && actionPath.data.requestId !== parsed.data.requestId) {
      return contractJson(c, apiErrorSchema, invalid, 400)
    }
    try {
      const receipt = operation === 'propose'
        ? store.proposeSettingExtension(workId, settingExtensionProposeRequestSchema.parse(parsed.data))
        : operation === 'approve' ? store.approveSettingExtension(workId, parsed.data) : store.cancelSettingExtension(workId, parsed.data)
      return contractJson(c, settingExtensionReceiptSchema, receipt, operation === 'propose' ? 201 : 200)
    } catch (error) {
      if (error instanceof KnownError && statuses[error.code]) return contractJson(c, apiErrorSchema,
        { code: error.code, message: error.code, retryable: false }, statuses[error.code])
      // A failure after the store returns/throws may be a committed lost response.
      // Never fabricate not-committed; callers resolve uncertainty via GET only.
      return responseUnavailable(c)
    }
  })
  return app
}
