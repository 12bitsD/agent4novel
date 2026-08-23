import { Hono } from 'hono'
import { worksRoutes } from './routes/works.js'
import type { WorkStore } from './store/work-store.js'

export function createApp(store: WorkStore): Hono {
  const app = new Hono()
  app.route('/', worksRoutes(store))
  return app
}
