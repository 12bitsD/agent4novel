import { expect, it } from 'vitest'
import { advanceOutcomeDtoSchema, workViewSchema, apiErrorSchema, gateRefSchema,
  beatCommandErrorSchema, proseCommandErrorSchema, httpErrorSchema } from '../src/index.js'

const view = { id: 'w1', title: '海港', seed: '海港故事', config: {}, createdAt: 'today', workflowState: 'ready-to-generate', nextStepId: 'setting', allowedActions: ['generate'] }

it('公开读模型携带下一步，advance 保留状态和遥测，错误保留字段定位', () => {
  const work = { id: 'w1', title: '海港', seed: '海港故事', config: {}, createdAt: 'today', artifacts: [], workflowState: 'ready-to-generate', nextStepId: 'setting', allowedActions: ['generate'] }
  expect(workViewSchema.parse(work).nextStepId).toBe('setting')
  expect(workViewSchema.safeParse({ ...work, nextStepId: undefined }).success).toBe(false)
  const advance = { kind: 'advanced', stepId: 'setting', state: { workId: 'w1', stage: 'awaiting-approval', nextStepId: null, pendingGate: { kind: 'setting' } }, telemetry: [] }
  expect(advanceOutcomeDtoSchema.parse(advance)).toEqual(advance)
  expect(advanceOutcomeDtoSchema.safeParse({ ...advance, state: undefined }).success).toBe(false)
  const error = { code: 'invalid-content', message: '内容无效', retryable: false, issues: [{ path: ['content', 'world', 0, 'title'], code: 'too_small', message: '不能为空' }] }
  expect(apiErrorSchema.parse(error).issues?.[0]?.path).toEqual(['content', 'world', 0, 'title'])
})

it('公开普通与命令错误契约接受可选的截断总数和标记', () => {
  const error = { code: 'invalid-content', message: 'invalid content', retryable: false,
    issues: [{ path: ['content'], code: 'custom', message: 'invalid field' }], issueCount: 129, issuesTruncated: true }
  for (const schema of [apiErrorSchema, httpErrorSchema]) {
    expect(schema.safeParse(error).success).toBe(true)
  }
  const command = { kind: 'request-rejected', requestId: '11111111-1111-4111-8111-111111111111',
    executionMode: 'demo', latencyMs: 0, writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [] }
  for (const [schema, operation] of [[beatCommandErrorSchema, 'approve-beat'], [proseCommandErrorSchema, 'save-prose']] as const) {
    expect(schema.safeParse({ ...error, code: 'invalid-input', message: 'invalid input', command: { ...command, operation } }).success).toBe(true)
  }
  const ordinary = { code: 'invalid-input', message: 'invalid input', retryable: false }
  expect(apiErrorSchema.parse(ordinary)).toEqual(ordinary)
})

it('关卡地址与产物地址使用相同的章节边界', () => {
  expect(gateRefSchema.parse({ kind: 'beat', chapter: 2 })).toEqual({ kind: 'beat', chapter: 2 })
  for (const gate of [{ kind: 'beat' }, { kind: 'prose', chapter: Number.MAX_SAFE_INTEGER + 1 }, { kind: 'setting', chapter: 1 }]) {
    expect(gateRefSchema.safeParse(gate).success).toBe(false)
  }
})

it('作品读模型拒绝未知配置字段，不静默忽略协议漂移', () => {
  expect(workViewSchema.safeParse({ ...view, artifacts: [], config: { model: 'kimi:kimi-k2.8-highspeed', futureOption: true } }).success).toBe(false)
  expect(workViewSchema.safeParse({ ...view, artifacts: [], config: { model: 'kimi:kimi-k2.8-highspeed' } }).success).toBe(true)
})
