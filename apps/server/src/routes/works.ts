import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import {
  artifactKinds,
  interviewAnswerSchema,
  perChapterKinds,
  perWorkKinds,
  preprocessContentSchema,
} from '@agent4novel/contracts'
import type { Pipeline } from '../pipeline/pipeline.js'
import type { WorkStore } from '../store/work-store.js'

const workCreateSchema = z.object({
  seed: z.string().min(1),
  title: z.string().optional(),
})

const savePreprocessSchema = z.object({
  content: preprocessContentSchema,
})

const answerInterviewBodySchema = z.object({
  answers: z.array(interviewAnswerSchema),
})

const approveBodySchema = z
  .object({
    kind: z.enum(artifactKinds),
    chapter: z.number().optional(),
  })
  .superRefine((v, ctx) => {
    if (perChapterKinds.includes(v.kind) && v.chapter === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `kind "${v.kind}" requires a chapter` })
    }
    if (perWorkKinds.includes(v.kind) && v.chapter !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `kind "${v.kind}" must not have a chapter`,
      })
    }
  })

async function readJsonBody(
  c: Context,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, data: await c.req.json() }
  } catch {
    return { ok: false, response: c.json({ error: 'invalid json body' }, 400) }
  }
}

// pipeline/store 已知错误 → 4xx；其余（含 agent 输出不稳）→ 500 兜底
function routeError(c: Context, err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.startsWith('work not found')) return c.json({ error: msg }, 404)
  if (msg.startsWith('no pending interview')) return c.json({ error: msg }, 400)
  if (msg.startsWith('artifact not found')) return c.json({ error: msg }, 400)
  return c.json({ error: msg }, 500)
}

export type WorksRoutesDeps = {
  store: WorkStore
  pipeline: Pipeline
}

export function worksRoutes({ store, pipeline }: WorksRoutesDeps): Hono {
  const app = new Hono()

  app.get('/api/works', (c) => c.json(store.listWorks()))

  app.post('/api/works', async (c) => {
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = workCreateSchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
    }
    const work = store.createWork(parsed.data)
    return c.json(work, 201)
  })

  app.get('/api/works/:id', (c) => {
    const work = store.getWork(c.req.param('id'))
    if (!work) return c.json({ error: 'not found' }, 404)
    return c.json(work)
  })

  app.put('/api/works/:id/artifacts/preprocess', async (c) => {
    const workId = c.req.param('id')
    if (!store.getWork(workId)) return c.json({ error: 'not found' }, 404)
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = savePreprocessSchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json({ error: 'invalid content', issues: parsed.error.issues }, 400)
    }
    const artifact = store.appendArtifact(workId, 'preprocess', parsed.data.content)
    store.setStatus(workId, 'preprocess', 'approved') // 人工保存即确认
    return c.json(artifact)
  })

  app.post('/api/works/:id/advance', async (c) => {
    try {
      const result = await pipeline.advance(c.req.param('id'))
      return c.json(result.state)
    } catch (err) {
      return routeError(c, err)
    }
  })

  app.post('/api/works/:id/answer-interview', async (c) => {
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = answerInterviewBodySchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
    }
    try {
      const result = await pipeline.answerInterview(c.req.param('id'), parsed.data.answers)
      return c.json(result.state)
    } catch (err) {
      return routeError(c, err)
    }
  })

  app.post('/api/works/:id/approve', async (c) => {
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = approveBodySchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
    }
    try {
      const workId = c.req.param('id')
      pipeline.approve(workId, parsed.data.kind, parsed.data.chapter)
      return c.json(pipeline.getState(workId))
    } catch (err) {
      return routeError(c, err)
    }
  })

  return app
}
