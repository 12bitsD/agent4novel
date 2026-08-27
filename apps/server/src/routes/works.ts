import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import {
  artifactKinds,
  creativeContentSchema,
  outlineContentSchema,
  outlineDraftSchema,
  perChapterKinds,
  perWorkKinds,
} from '@agent4novel/contracts'
import type { ApiError, ArtifactKind, OutlineContent, OutlineDraft, WorkflowState, WorkView } from '@agent4novel/contracts'
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

// saveOutlineDraft(#4):保存草稿,永远 pending;id 可缺省(新增项),server 规整时补注入
const saveOutlineSchema = z.object({
  content: outlineDraftSchema,
  expectedHeadVersion: z.number().int().min(1),
})

// id 规整(#4 决策 6):已有 id 保留(上下移/编辑不动标识),新项(无 id)按「现存最大序号 +1」
// 补注入,保持与生成时相同的位置编号格式(删除后按位置重排会撞号,故取 max+1)
function nextId(prefix: string, existing: string[]): string {
  const max = existing.reduce((m, id) => {
    const match = /(\d+)$/.exec(id)
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return `${prefix}${max + 1}`
}

function normalizeOutlineIds(workId: string, draft: OutlineDraft): OutlineContent {
  const content = {
    arcs: draft.arcs.map((arc) => {
      const arcId = arc.arcId ?? nextId(`${workId}-arc-`, draft.arcs.map((a) => a.arcId ?? ''))
      return {
        ...arc,
        arcId,
        segments: arc.segments.map((seg) => ({
          ...seg,
          segmentId: seg.segmentId ?? nextId(`${arcId}-seg-`, arc.segments.map((x) => x.segmentId ?? '')),
        })),
      }
    }),
  }
  return outlineContentSchema.parse(content)
}

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

// 乐观锁:expectedHeadVersion 必须等于当前 head,否则 409(#3c 决策 9)
function assertHead(
  c: Context,
  store: WorkStore,
  workId: string,
  kind: ArtifactKind,
  expected: number,
): Response | null {
  const head = store.headVersion(workId, kind)
  if (head === undefined || head !== expected) {
    return c.json(
      errorBody('version-conflict', `head is ${head ?? 'none'}, expected ${expected}`),
      409,
    )
  }
  return null
}

// 读模型(#3c 决策 11,#4 按 pendingGate.kind 分派):与 artifacts 同一快照派生,web 只渲染不重建状态机
function workflowOf(
  state: ReturnType<Pipeline['getState']>,
  failure: { stepId: string; code: string; retryable: boolean } | null,
): {
  workflowState: WorkflowState
  allowedActions: string[]
} {
  switch (state.stage) {
    case 'ready':
      // 最近一次 advance 失败过 → failed(可重试,重试 = 同一 advance)
      if (failure) return { workflowState: 'failed', allowedActions: ['generate'] }
      return { workflowState: 'ready-to-generate', allowedActions: ['generate'] }
    case 'awaiting-approval': {
      // 按关卡 kind 显式分派(新节点进来必须在此登记,否则响亮失败)
      const gate = state.pendingGate?.kind
      if (gate === 'creative') {
        return { workflowState: 'awaiting-selection', allowedActions: ['save-draft', 'select', 'generate'] }
      }
      if (gate === 'outline') {
        return { workflowState: 'awaiting-outline-review', allowedActions: ['save-draft', 'approve'] }
      }
      throw new Error(`unknown gate kind: ${gate ?? 'none'}`)
    }
    case 'complete':
      // complete 映射 definition 末端关卡(当前 = outline);新末端节点进来时在此更新
      return { workflowState: 'outline-approved', allowedActions: [] }
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
    const view: WorkView = {
      ...work,
      ...workflowOf(pipeline.getState(workId), pipeline.failureOf(workId)),
    }
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
    const conflict = assertHead(c, store, workId, 'creative', parsed.data.expectedHeadVersion)
    if (conflict) return conflict
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
    const conflict = assertHead(c, store, workId, 'creative', parsed.data.expectedHeadVersion)
    if (conflict) return conflict
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

  // saveOutlineDraft(#4):保存大纲草稿,永远 pending;「通过」走通用 /approve
  app.put('/api/works/:id/artifacts/outline', async (c) => {
    const workId = c.req.param('id')
    if (!store.getWork(workId)) return c.json(errorBody('work-not-found', 'not found'), 404)
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = saveOutlineSchema.safeParse(body.data)
    if (!parsed.success) {
      return c.json(
        { ...errorBody('invalid-content', 'invalid content'), issues: parsed.error.issues },
        422,
      )
    }
    const conflict = assertHead(c, store, workId, 'outline', parsed.data.expectedHeadVersion)
    if (conflict) return conflict
    const artifact = store.appendArtifact(
      workId,
      'outline',
      normalizeOutlineIds(workId, parsed.data.content),
    )
    return c.json(artifact)
  })

  // advance = 推进到下一个关卡(链式);返回可穷举 outcome
  app.post('/api/works/:id/advance', async (c) => {
    const workId = c.req.param('id')
    const requestId = crypto.randomUUID()
    const started = Date.now()
    try {
      const outcome = await pipeline.advance(workId)
      console.log(
        JSON.stringify({
          event: 'pipeline.advance',
          requestId,
          workId,
          outcome: outcome.kind,
          latencyMs: Date.now() - started,
        }),
      )
      return c.json(outcome)
    } catch (err) {
      if (err instanceof KnownError && err.code === 'advance-in-progress') {
        console.log(JSON.stringify({ event: 'pipeline.lock-conflict', requestId, workId }))
      }
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
    // creative 的「通过」只能走 select(恰好 1 方向);通用 approve 对它关闭
    if (parsed.data.kind === 'creative') {
      return c.json(
        errorBody(
          'direction-not-selected',
          'creative must be approved via POST .../artifacts/creative/select',
        ),
        409,
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
