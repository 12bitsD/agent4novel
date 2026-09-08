import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context } from 'hono'
import { z } from 'zod'
import {
  artifactKinds,
  creativeContentSchema,
  outlineContentSchema,
  outlineDraftSchema,
  perChapterKinds,
  perWorkKinds,
  settingApproveRequestSchema,
  settingLimits,
  beatApproveRequestSchema, beatRequestHeadSchema, beatLimits, beatCommandResponseSchema, beatCommandErrorSchema,
  beatRegenerateRequestSchema,
  diagnosticQuerySchema,
  workViewSchema,
} from '@agent4novel/contracts'
import type { ApiError, ArtifactKind, OutlineContent, OutlineDraft, WorkflowState, WorkView } from '@agent4novel/contracts'
import type { Pipeline } from '../pipeline/pipeline.js'
import { KnownError } from '../errors.js'
import { diagnosticsFor, withRequest, currentRequest, recordCommand } from '../steps/telemetry.js'
import type { WorkStore } from '../store/work-store.js'
import { approveSetting, SettingValidationError } from '../setting-review.js'
import { approveBeat } from '../beat-review.js'
import { observeBeat, BeatCommandError, beatFailureCode } from '../beat-command.js'
import { safeLog } from '../safe-log.js'

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
      case 'upstream-changed':
      case 'artifact-already-approved':
      case 'setting-gate-not-ready':
      case 'setting-approval-required':
      case 'beat-approval-required':
      case 'beat-gate-not-ready':
      case 'direction-not-selected':
        return c.json(body, 409)
      case 'llm-invalid-output':
        return c.json(body, 502)
      case 'llm-timeout':
        return c.json(body, 504)
      case 'llm-unavailable':
        return c.json(body, 503)
      case 'input-budget-exceeded':
        return c.json(body, 422)
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
  completionKind: ArtifactKind | undefined,
): {
  workflowState: WorkflowState
  allowedActions: string[]
} {
  switch (state.stage) {
    case 'ready':
      // 最近一次 advance 失败过 → failed(可重试,重试 = 同一 advance)
      if (failure) return { workflowState: 'failed', allowedActions: failure.retryable ? ['generate'] : [] }
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
      if (gate === 'setting') {
        return { workflowState: 'awaiting-setting-review', allowedActions: ['approve'] }
      }
      if (gate === 'beat') {
        return { workflowState: 'awaiting-beat-review', allowedActions: ['approve', 'regenerate'] }
      }
      throw new Error(`unknown gate kind: ${gate ?? 'none'}`)
    }
    case 'complete':
      return { workflowState: completionKind === 'beat' ? 'beat-approved' : completionKind === 'setting' ? 'setting-approved' : 'outline-approved', allowedActions: [] }
    case 'blocked':
      return { workflowState: 'ready-to-generate', allowedActions: [] }
  }
}

export type WorksRoutesDeps = {
  store: WorkStore
  pipeline: Pipeline
  meta?: { demo: boolean }
}

export function worksRoutes({ store, pipeline, meta }: WorksRoutesDeps): Hono {
  const app = new Hono()

  app.use('/api/works/:id/artifacts/beat/*', async (_c, next) => withRequest(crypto.randomUUID(), meta?.demo ?? true, next))
  const rejectBeatRequest = (c: Context, code: 'bad-json' | 'invalid-input' | 'unsupported-chapter' | 'payload-too-large') => {
    const scope = currentRequest()!
    const failure = beatCommandErrorSchema.parse({
      code, message: code, retryable: false,
      command: { kind: 'request-rejected', requestId: scope.requestId, operation: c.req.path.endsWith('/regenerate') ? 'regenerate-beat' : 'approve-beat',
        executionMode: scope.executionMode, latencyMs: Date.now() - scope.startedAt, writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [] },
    })
    const workId = c.req.param('id')
    if (workId) recordCommand(workId, failure.command, code)
    return c.json(failure, code === 'payload-too-large' ? 413 : 400)
  }
  for (const operation of ['approve', 'regenerate'] as const) app.post(`/api/works/:id/artifacts/beat/${operation}`, bodyLimit({
    maxSize: beatLimits.bodyBytes, onError: c => rejectBeatRequest(c, 'payload-too-large'),
  }), async c => {
    let body: unknown
    try { body = await c.req.json() } catch { return rejectBeatRequest(c, 'bad-json') }
    const head = beatRequestHeadSchema.passthrough().safeParse(body)
    if (!head.success) {
      const unsupported = head.error.issues.some(issue => issue.path[0] === 'chapter')
      return rejectBeatRequest(c, unsupported ? 'unsupported-chapter' : 'invalid-input')
    }
    const parsed = (operation === 'approve' ? beatApproveRequestSchema : beatRegenerateRequestSchema).safeParse(body)
    if (!parsed.success && parsed.error.issues.some(issue => issue.path[0] !== 'content' && issue.path[0] !== 'instructions')) return rejectBeatRequest(c, 'invalid-input')
    const workId = c.req.param('id')
    try {
      if (!parsed.success) await observeBeat(workId, operation === 'approve' ? 'approve-beat' : 'regenerate-beat', { artifactId: head.data.expectedArtifactId, version: head.data.expectedHeadVersion }, execution => {
        execution.stage = 'input'
        throw parsed.error
      })
      if (!parsed.success) throw new Error('unreachable')
      const result = operation === 'approve'
        ? await approveBeat(store, workId, beatApproveRequestSchema.parse(parsed.data))
        : await pipeline.regenerateBeat(workId, beatRegenerateRequestSchema.parse(parsed.data))
      const state = pipeline.getState(workId)
      return c.json(beatCommandResponseSchema.parse({ ...result,
        workflow: { ...workflowOf(state, pipeline.failureOf(workId), pipeline.completionKind), nextStepId: state.nextStepId },
        telemetry: currentRequest()!.telemetry,
      }))
    } catch (err) {
      if (!(err instanceof BeatCommandError)) return c.json(errorBody('internal-error', 'beat response unavailable'), 500)
      const known = err.cause instanceof KnownError ? err.cause : undefined
      const invalid = err.cause instanceof z.ZodError ? err.cause : undefined
      const code = beatFailureCode(err.cause, err.command.failureStage ?? 'response')
      const status = code === 'invalid-content' || code === 'input-budget-exceeded' ? 422 : code === 'work-not-found' || code === 'artifact-not-found' ? 404
        : code === 'llm-invalid-output' ? 502 : code === 'llm-unavailable' ? 503 : code === 'llm-timeout' ? 504 : known ? 409 : 500
      return c.json(beatCommandErrorSchema.parse({
        code, message: code, retryable: known?.retryable ?? false, command: err.command, telemetry: currentRequest()!.telemetry,
        ...(known?.inputBudget ? { inputBudget: known.inputBudget } : {}),
        ...(invalid && code === 'invalid-content' ? { issues: invalid.issues.slice(0, 128).map(issue => ({ path: issue.path[0] === 'content' || issue.path[0] === 'instructions' ? issue.path : ['content', ...issue.path], code: issue.code, message: 'invalid field' })) } : {}),
      }), status)
    }
  })

  app.post('/api/works/:id/artifacts/setting/approve', bodyLimit({
    maxSize: settingLimits.bodyBytes,
    onError: (c) => c.json(errorBody('payload-too-large', 'setting request exceeds body limit'), 413),
  }), async (c) => {
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = settingApproveRequestSchema.safeParse(body.data)
    if (!parsed.success) {
      const contentError = parsed.error.issues.every((issue) => issue.path[0] === 'content')
      return c.json({
        ...errorBody(contentError ? 'invalid-content' : 'invalid-input', 'invalid setting request'),
        issues: parsed.error.issues.map(({ path, code, message }) => ({ path, code, message })),
      }, contentError ? 422 : 400)
    }
    try {
      return c.json(approveSetting(store, c.req.param('id'), parsed.data))
    } catch (err) {
      if (err instanceof SettingValidationError) return c.json({
        ...errorBody('invalid-content', 'invalid setting content'),
        issues: err.issues.map(({ path, code, message }) => ({ path: ['content', ...path], code, message })),
      }, 422)
      return routeError(c, err instanceof KnownError ? err : new Error('setting approval failed'))
    }
  })

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
    const state = pipeline.getState(workId)
    const view: WorkView = {
      ...work,
      ...workflowOf(state, pipeline.failureOf(workId), pipeline.completionKind),
      nextStepId: state.nextStepId,
    }
    const parsed = workViewSchema.safeParse(view)
    if (!parsed.success) return c.json(errorBody('internal-error', 'invalid work snapshot'), 500)
    return c.json(parsed.data)
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
    store.appendArtifact(workId, 'creative', { directions: [pack] })
    store.setStatus(workId, 'creative', 'approved')
    return c.json(store.getWork(workId)!.artifacts.find((artifact) => artifact.kind === 'creative')!)
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

  // advance = 推进到下一个关卡(链式);返回可穷举 outcome。
  // #14:响应内联本次推进期间的 LLM 遥测(账本 cursor 前后差集),Agent 一次调用拿到完整观测
  app.post('/api/works/:id/advance', async (c) => {
    const workId = c.req.param('id')
    const requestId = crypto.randomUUID()
    const started = Date.now()
    try {
      const { outcome, telemetry } = await withRequest(requestId, meta?.demo ?? true, async scope => ({ outcome: await pipeline.advance(workId), telemetry: scope.telemetry }))
      safeLog({
          event: 'pipeline.advance',
          requestId,
          workId,
          outcome: outcome.kind,
          latencyMs: Date.now() - started,
        })
      return c.json({ ...outcome, telemetry })
    } catch (err) {
      if (err instanceof KnownError && err.code === 'advance-in-progress') {
        safeLog({ event: 'pipeline.lock-conflict', requestId, workId })
      }
      return routeError(c, err)
    }
  })

  // LLM 遥测查询口(#14):回看某作品的全部 callLlm 记录(进程内账本,随进程生命周期)
  app.get('/api/works/:id/telemetry', (c) => {
    const workId = c.req.param('id')
    if (!store.getWork(workId)) return c.json(errorBody('work-not-found', 'not found'), 404)
    const raw = c.req.queries()
    if (Object.values(raw).some(values => values.length !== 1)) return c.json(errorBody('invalid-input', 'invalid diagnostic query'), 400)
    const query = diagnosticQuerySchema.safeParse(c.req.query())
    if (!query.success) return c.json(errorBody('invalid-input', 'invalid diagnostic query'), 400)
    return c.json(diagnosticsFor(workId, query.data))
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
