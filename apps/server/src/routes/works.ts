import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { artifactKinds, creativeContentSchema, perChapterKinds, perWorkKinds } from '@agent4novel/contracts'
import type { ApiError, WorkflowState, WorkView } from '@agent4novel/contracts'
import type { Pipeline } from '../pipeline/pipeline.js'
import { KnownError } from '../errors.js'
import type { WorkStore } from '../store/work-store.js'

const workCreateSchema = z.object({
  seed: z.string().min(1),
  title: z.string().optional(),
})

// saveCreativeDraft(#3c):保存全部方向,永远 pending;expectedHeadVersion 乐观锁
const saveCreativeSchema = z.object({
  content: creativeContentSchema,
  expectedHeadVersion: z.number().int().min(1),
})

// selectCreativeDirection(#3c):显式选定单方向 → 落单方向新版本 + approved
const selectCreativeSchema = z.object({
  directionId: z.string().min(1),
  expectedHeadVersion: z.number().int().min(1),
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

function errorBody(code: string, message: string, retryable = false, attemptId?: string): ApiError {
  return { code, message, retryable, ...(attemptId ? { attemptId } : {}) }
}

async function readJsonBody(
  c: Context,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, data: await c.req.json() }
  } catch {
    return { ok: false, response: c.json(errorBody('bad-json', 'invalid json body'), 400) }
  }
}

// 错误分类(#3c 决策 16):依赖未就绪/版本冲突 409,内容非法 400/422,
// 模型输出非法 502,不可用/超时 503/504,未知 500
function routeError(c: Context, err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err)
  if (err instanceof KnownError) {
    const body = errorBody(err.code, msg, err.retryable, err.attemptId)
    switch (err.code) {
      case 'work-not-found':
      case 'artifact-not-found':
        return c.json(body, 404)
      case 'advance-in-progress':
      case 'version-conflict':
      case 'direction-not-selected':
        return c.json(body, 409)
      case 'llm-invalid-output':
        return c.json(body, 502)
      case 'llm-timeout':
        return c.json(body, 504)
      case 'llm-unavailable':
        return c.json(body, 503)
    }
  }
  return c.json(errorBody('internal', msg), 500)
}

// 读模型(#3c 决策 11):与 artifacts 同一快照派生,web 只渲染不重建状态机
function workflowOf(state: ReturnType<Pipeline['getState']>): {
  workflowState: WorkflowState
  allowedActions: string[]
} {
  switch (state.stage) {
    case 'ready':
      return { workflowState: 'ready-to-generate', allowedActions: ['generate'] }
    case 'awaiting-approval':
      return {
        workflowState: 'awaiting-selection',
        allowedActions: ['save-draft', 'select', 'generate'],
      }
    case 'complete':
      return { workflowState: 'selected', allowedActions: ['save-draft'] }
    case 'blocked':
      return { workflowState: 'ready-to-generate', allowedActions: [] }
  }
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
      return c.json(
        { ...errorBody('invalid-input', 'invalid input'), issues: parsed.error.issues },
        400,
      )
    }
    const work = store.createWork(parsed.data)
    return c.json(work, 201)
  })

  app.get('/api/works/:id', (c) => {
    const workId = c.req.param('id')
    const work = store.getWork(workId)
    if (!work) return c.json(errorBody('work-not-found', 'not found'), 404)
    const view: WorkView = { ...work, ...workflowOf(pipeline.getState(workId)) }
    return c.json(view)
  })

  // saveCreativeDraft:存全部方向,永远 pending(不再是「人工保存即通过」)
  app.put('/api/works/:id/artifacts/creative', async (c) => {
    const workId = c.req.param('id')
    if (!store.getWork(workId)) return c.json(errorBody('work-not-found', 'not found'), 404)
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = saveCreativeSchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json(
        { ...errorBody('invalid-content', 'invalid content'), issues: parsed.error.issues },
        422,
      )
    }
    const head = store.headVersion(workId, 'creative')
    if (head === undefined || head !== parsed.data.expectedHeadVersion) {
      return c.json(
        errorBody('version-conflict', `head is ${head ?? 'none'}, expected ${parsed.data.expectedHeadVersion}`),
        409,
      )
    }
    const artifact = store.appendArtifact(workId, 'creative', parsed.data.content)
    return c.json(artifact)
  })

  // selectCreativeDirection:显式选定单方向 → 单方向新版本 + approved
  app.post('/api/works/:id/artifacts/creative/select', async (c) => {
    const workId = c.req.param('id')
    const work = store.getWork(workId)
    if (!work) return c.json(errorBody('work-not-found', 'not found'), 404)
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = selectCreativeSchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json(
        { ...errorBody('invalid-input', 'invalid input'), issues: parsed.error.issues },
        400,
      )
    }
    const head = store.headVersion(workId, 'creative')
    if (head === undefined || head !== parsed.data.expectedHeadVersion) {
      return c.json(
        errorBody('version-conflict', `head is ${head ?? 'none'}, expected ${parsed.data.expectedHeadVersion}`),
        409,
      )
    }
    const current = work.artifacts.find((a) => a.kind === 'creative')
    const content = creativeContentSchema.safeParse(current?.content)
    if (!current || !content.success) {
      return c.json(errorBody('artifact-not-found', 'no creative artifact'), 404)
    }
    const pack = content.data.directions.find((d) => d.directionId === parsed.data.directionId)
    if (!pack) {
      return c.json(
        errorBody('direction-not-selected', `direction not found: ${parsed.data.directionId}`),
        409,
      )
    }
    const artifact = store.appendArtifact(workId, 'creative', { directions: [pack] })
    store.setStatus(workId, 'creative', 'approved')
    return c.json(artifact)
  })

  // advance = 推进到下一个关卡(链式);返回可穷举 outcome
  app.post('/api/works/:id/advance', async (c) => {
    const workId = c.req.param('id')
    const started = Date.now()
    try {
      const outcome = await pipeline.advance(workId)
      console.log(
        JSON.stringify({ event: 'pipeline.advance', workId, outcome: outcome.kind, latencyMs: Date.now() - started }),
      )
      return c.json(outcome)
    } catch (err) {
      return routeError(c, err)
    }
  })

  app.post('/api/works/:id/approve', async (c) => {
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = approveBodySchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json(
        { ...errorBody('invalid-input', 'invalid input'), issues: parsed.error.issues },
        400,
      )
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
