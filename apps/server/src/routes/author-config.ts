import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { agentFileSchema, agentFileReadSchema, authorConfigReceiptSchema, authorConfigViewSchema } from '@agent4novel/contracts'
import type { AgentFileUpload, AuthorConfigSave } from '@agent4novel/contracts'
import type { AuthorConfigService } from '../config/author-config-service.js'
import { KnownError } from '../errors.js'
import { contractJson, responseUnavailable } from '../contract-response.js'

export function authorConfigRoutes(service: AuthorConfigService) {
  const app = new Hono()
  const base = '/api/works/:id'
  const limit = bodyLimit({ maxSize: 196_608, onError: c => c.json({ code: 'payload-too-large', message: 'configuration request exceeds byte limit', retryable: false }, 413) })
  app.use(`${base}/agent-config`, limit)
  app.use(`${base}/agent-files`, limit)
  app.onError((error, c) => {
    if (error instanceof KnownError) {
      const status = error.code === 'version-conflict' ? 409 : error.code === 'work-not-found' || error.code === 'agent-file-unavailable' ? 404 : 400
      return c.json({ code: error.code, message: error.message, retryable: false }, status)
    }
    return responseUnavailable(c)
  })
  async function body(c: Context) {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await c.req.arrayBuffer())) }
    catch { throw new KnownError('config-invalid', 'invalid configuration request') }
  }
  app.get(`${base}/agent-config`, c => contractJson(c, authorConfigViewSchema, service.get(c.req.param('id'))))
  app.put(`${base}/agent-config`, async c => contractJson(c, authorConfigReceiptSchema, service.save(c.req.param('id'), await body(c) as AuthorConfigSave)))
  app.post(`${base}/agent-files`, async c => contractJson(c, agentFileSchema, service.upload(c.req.param('id'), await body(c) as AgentFileUpload)))
  app.get(`${base}/agent-files/:fileId`, c => contractJson(c, agentFileReadSchema, service.readFile(c.req.param('id'), c.req.param('fileId'))))
  return app
}
