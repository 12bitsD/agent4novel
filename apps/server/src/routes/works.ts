import { Hono } from 'hono'
import type { WorkStore } from '../store/work-store.js'

export function worksRoutes(store: WorkStore): Hono {
  const app = new Hono()

  app.get('/api/works', (c) => c.json(store.listWorks()))

  app.get('/api/works/:id', (c) => {
    const work = store.getWork(c.req.param('id'))
    if (!work) return c.json({ error: 'not found' }, 404)
    return c.json(work)
  })

  return app
}
