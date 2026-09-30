import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { badExampleLimits, badExampleQuerySchema, badExampleSchema, badExamplePageSchema } from '@agent4novel/contracts'
import type { BadExampleRepository } from '../bad-examples/repository.js'
import { KnownError } from '../errors.js'
import { contractJson, responseUnavailable } from '../contract-response.js'

export function badExampleRoutes(repository: BadExampleRepository) {
  const app = new Hono(), base = '/api/works/:id/bad-examples'
  app.use(base, bodyLimit({ maxSize: badExampleLimits.requestBytes, onError: c => c.json({ code: 'payload-too-large', message: 'selection request exceeds byte limit', retryable: false }, 413) }))
  app.onError((error, c) => error instanceof KnownError
    ? c.json({ code: error.code, message: error.message, retryable: false }, error.code === 'version-conflict' ? 409 : ['work-not-found', 'bad-example-not-found'].includes(error.code) ? 404 : 400)
    : responseUnavailable(c))
  app.post(base, async c => {
    let input: unknown
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await c.req.arrayBuffer())) }
    catch { throw new KnownError('bad-example-invalid', 'invalid selection request') }
    return contractJson(c, badExampleSchema, repository.markBadExample(c.req.param('id'), input as Parameters<BadExampleRepository['markBadExample']>[1]))
  })
  app.get(base, c => {
    const params = new URL(c.req.url).searchParams, values: Record<string, number> = {}
    for (const [key, value] of params) {
      if (!['chapter', 'after'].includes(key) || params.getAll(key).length !== 1 || !/^[1-9][0-9]*$/.test(value)) throw new KnownError('bad-example-invalid', 'invalid selection query')
      values[key] = Number(value)
    }
    const query = badExampleQuerySchema.safeParse(values)
    if (!query.success) throw new KnownError('bad-example-invalid', 'invalid selection query')
    return contractJson(c, badExamplePageSchema, repository.listBadExamples(c.req.param('id'), query.data))
  })
  app.get(`${base}/:sampleId`, c => {
    const record = repository.getBadExample(c.req.param('id'), c.req.param('sampleId'))
    if (!record) throw new KnownError('bad-example-not-found', 'bad example not found')
    return contractJson(c, badExampleSchema, record)
  })
  return app
}
