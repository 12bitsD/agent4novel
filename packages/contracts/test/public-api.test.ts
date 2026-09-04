import { expect, it } from 'vitest'
import { advanceOutcomeDtoSchema, workViewSchema, apiErrorSchema } from '../src/index.js'

const view = { id: 'w1', title: '海港', seed: '海港故事', config: {}, createdAt: 'today', workflowState: 'ready-to-generate', nextStepId: 'setting', allowedActions: ['generate'] }
const artifact = { id: 'outline-1', workId: 'w1', kind: 'outline', version: 1, humanStatus: 'approved', content: {}, createdAt: 'today' }

it('公开作品读模型拒绝来自其他作品的产物，并定位归属字段', () => {
  expect(workViewSchema.safeParse({ ...view, artifacts: [artifact] }).success).toBe(true)
  const result = workViewSchema.safeParse({ ...view, artifacts: [{ ...artifact, workId: 'another-work' }] })
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['artifacts', 0, 'workId'])
})

it('公开读模型每个 kind/chapter 只允许一个当前 head，不把不同章节或不同 kind 当成重复', () => {
  const duplicateWorkHead = workViewSchema.safeParse({ ...view, artifacts: [artifact, { ...artifact, id: 'outline-2', version: 2 }] })
  expect(duplicateWorkHead.success).toBe(false)
  if (!duplicateWorkHead.success) expect(duplicateWorkHead.error.issues.map((issue) => issue.path)).toContainEqual(['artifacts', 1])
  const beat = { ...artifact, id: 'beat-1', kind: 'beat', chapter: 1 }
  expect(workViewSchema.safeParse({ ...view, artifacts: [beat, { ...beat, id: 'beat-2', version: 2 }] }).success).toBe(false)
  expect(workViewSchema.safeParse({ ...view, artifacts: [artifact, beat, { ...beat, id: 'beat-chapter-2', chapter: 2 }, { ...beat, id: 'prose-1', kind: 'prose' }] }).success).toBe(true)
})

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
