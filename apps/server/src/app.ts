import { Hono } from 'hono'
import { worksRoutes } from './routes/works.js'
import type { Pipeline } from './pipeline/pipeline.js'
import type { WorkStore } from './store/work-store.js'

// demo = 无 LLM key 的演示模式；interview = definition 里 preprocess 的 interview 开关（透出给启动界面）
export type AppMeta = { demo: boolean; interview: boolean }

export type AppDeps = {
  store: WorkStore
  pipeline: Pipeline
  meta: AppMeta
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  app.get('/api/config', (c) => c.json(deps.meta))
  app.route('/', worksRoutes(deps))
  return app
}
