import { Hono } from 'hono'
import { z } from 'zod'
import { preprocessContentSchema } from '@agent4novel/contracts'
import type { WorkStore } from '../store/work-store.js'

const workCreateSchema = z.object({
  seed: z.string().min(1),
  title: z.string().optional(),
})

const savePreprocessSchema = z.object({
  content: preprocessContentSchema,
})

export function worksRoutes(store: WorkStore): Hono {
  const app = new Hono()

  app.get('/api/works', (c) => c.json(store.listWorks()))

  app.post('/api/works', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }
    const parsed = workCreateSchema.safeParse(body)
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
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }
    const parsed = savePreprocessSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid content', issues: parsed.error.issues }, 400)
    }
    const artifact = store.appendArtifact(workId, 'preprocess', parsed.data.content)
    store.setStatus(workId, 'preprocess', 'approved') // 人工保存即确认
    return c.json(artifact)
  })

  return app
}
