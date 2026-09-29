import { Hono } from 'hono'
import { worksRoutes } from './routes/works.js'
import type { Pipeline } from './pipeline/pipeline.js'
import type { WorkStore } from './store/work-store.js'
import { appConfigSchema, type AppConfig } from '@agent4novel/contracts'
import { contractJson, responseUnavailable } from './contract-response.js'

// demo = 无 LLM key 的演示模式
export type AppMeta = AppConfig

export type AppDeps = {
  store: WorkStore
  pipeline: Pipeline
  meta: AppMeta
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  app.onError((_error, c) => responseUnavailable(c))
  app.notFound(c => c.json({ code: 'not-found', message: 'route not found', retryable: false }, 404))
  app.get('/api/config', (c) => contractJson(c, appConfigSchema, deps.meta))
  app.route('/', worksRoutes(deps))
  return app
}
