import { describe, expect, it } from 'vitest'
import type { SettingArtifact, WorkView } from '@agent4novel/contracts'
import { initSettingReview, isSettingDirty, reduceSettingReview, toSettingSubmission } from '../src/setting-review.js'

export function pendingSetting(): SettingArtifact {
  return {
    id: 'setting-1', workId: 'work-1', kind: 'setting', version: 1,
    humanStatus: 'pending', createdAt: '2026-09-05T00:00:00.000Z',
    content: {
      overview: '海港里的故事',
      world: [{ itemId: 'world-1', title: '海港', content: '每晚闭港。' }],
      characters: [{ itemId: 'person-1', title: '船长', content: '寻找家人。' }],
      factions: [], relationships: [], extensions: [],
    },
  }
}
function currentWork(artifact = pendingSetting()): WorkView {
  return { id: 'work-1', title: '海港', seed: '海港故事', config: {}, createdAt: 'today', artifacts: [artifact],
    workflowState: artifact.humanStatus === 'approved' ? 'setting-approved' : 'awaiting-setting-review',
    nextStepId: null, allowedActions: artifact.humanStatus === 'approved' ? [] : ['approve'] }
}

describe('Setting 页内草稿', () => {
  it('后台回读与暂时退回大纲不丢页内草稿；远端已通过不能自动清除本地修改', () => {
    let state = initSettingReview(pendingSetting())
    state = reduceSettingReview(state, { type: 'overview', value: '只在本页' })
    state = reduceSettingReview(state, { type: 'observe-work', work: { ...currentWork(), workflowState: 'awaiting-outline-review' } })
    state = reduceSettingReview(state, { type: 'observe-work', work: currentWork() })
    expect(state.draft.overview).toBe('只在本页')
    expect(state.phase).toBe('editing')
    state = reduceSettingReview(state, { type: 'observe-work', work: currentWork({ ...pendingSetting(), humanStatus: 'approved' }) })
    expect(state.phase).toBe('conflict')
    expect(state.draft.overview).toBe('只在本页')
    expect(state.baseline.humanStatus).toBe('pending')
  })
  it('明确关卡拒绝不是未知写入；回读失败保持冲突，前置关卡恢复后可继续原草稿', () => {
    let state = initSettingReview(pendingSetting())
    state = reduceSettingReview(state, { type: 'overview', value: '我的修改' })
    state = reduceSettingReview(state, { type: 'submit' })
    state = reduceSettingReview(state, { type: 'rejected', status: 409, error: { code: 'setting-gate-not-ready', retryable: false, message: '上游待通过' } })
    state = reduceSettingReview(state, { type: 'readback-failed', message: '回读失败' })
    expect(state.phase).toBe('conflict')
    expect(state.hasUnknownWrite).toBe(false)
    state = reduceSettingReview(state, { type: 'readback', work: { ...currentWork(), workflowState: 'awaiting-outline-review' } })
    expect(state.canResume).toBe(false)
    state = reduceSettingReview(state, { type: 'readback', work: currentWork() })
    expect(state.canResume).toBe(true)
    state = reduceSettingReview(state, { type: 'resume' })
    expect(state.phase).toBe('editing')
    expect(state.draft.overview).toBe('我的修改')
    expect(state.submitted).toBeUndefined()
  })
  it('未知写入标记不被 pending 回读或重试的 422 清除，仅允许重试同一快照；匹配通过才清草稿', () => {
    let state = initSettingReview(pendingSetting())
    state = reduceSettingReview(state, { type: 'overview', value: '最终作者版本' })
    state = reduceSettingReview(state, { type: 'submit' })
    const submission = structuredClone(state.submitted!.request)
    state = reduceSettingReview(state, { type: 'unknown', message: '请求超时' })
    state = reduceSettingReview(state, { type: 'readback', work: currentWork() })
    expect(state.phase).toBe('uncertain')
    expect(state.hasUnknownWrite).toBe(true)
    expect(reduceSettingReview(state, { type: 'overview', value: '新版本' })).toBe(state)
    state = reduceSettingReview(state, { type: 'retry' })
    expect(state.submitted!.request).toEqual(submission)
    state = reduceSettingReview(state, { type: 'rejected', status: 422, error: { code: 'invalid-content', retryable: false, message: '校验失败' } })
    expect(state.phase).toBe('uncertain')
    const approved = pendingSetting()
    approved.humanStatus = 'approved'
    approved.content.overview = '最终作者版本'
    state = reduceSettingReview(state, { type: 'readback', work: currentWork(approved) })
    expect(state.phase).toBe('approved')
    expect(isSettingDirty(state)).toBe(false)
  })
  it('通过前校验完整内容，冻结规范化快照并禁止提交期间编辑；422 恢复草稿和字段位置', () => {
    let state = initSettingReview(pendingSetting())
    state = reduceSettingReview(state, { type: 'overview', value: '' })
    state = reduceSettingReview(state, { type: 'submit' })
    expect(state.phase).toBe('editing')
    expect(state.issues[0]?.path).toEqual(['content', 'overview'])
    state = reduceSettingReview(state, { type: 'overview', value: '作者改稿' })
    state = reduceSettingReview(state, { type: 'submit' })
    expect(state.phase).toBe('submitting')
    expect(state.submitted?.request.content.overview).toBe('作者改稿')
    expect(reduceSettingReview(state, { type: 'overview', value: '不能改' })).toBe(state)
    const key = state.draft.world[0]!.localKey
    state = reduceSettingReview(state, { type: 'rejected', status: 422, error: { code: 'invalid-content', retryable: false, message: '字段无效', issues: [{ path: ['content', 'world', 0, 'title'], code: 'custom', message: '标题无效' }] } })
    expect(state.phase).toBe('editing')
    expect(state.mode).toBe('edit')
    expect(state.focusTarget).toBe(`${key}:title`)
    expect(toSettingSubmission(state).content.overview).toBe('作者改稿')
  })
  it('补充栏目支持新增、重命名、移动卡片、重排和删除；栏目身份不暴露为文本编辑', () => {
    let state = initSettingReview(pendingSetting())
    state = reduceSettingReview(state, { type: 'add-section' })
    const first = state.draft.extensions[0]!.localKey
    state = reduceSettingReview(state, { type: 'rename-section', key: first, value: '航海技术' })
    state = reduceSettingReview(state, { type: 'move-item', key: state.draft.world[0]!.localKey, target: first })
    state = reduceSettingReview(state, { type: 'add-section' })
    const second = state.draft.extensions[1]!.localKey
    state = reduceSettingReview(state, { type: 'reorder-section', key: second, direction: -1 })
    expect(state.draft.extensions.map((section) => section.localKey)).toEqual([second, first])
    expect(toSettingSubmission(state).content.extensions[1]).toMatchObject({ title: '航海技术', items: [{ itemId: 'world-1' }] })
    state = reduceSettingReview(state, { type: 'remove-section', key: first })
    expect(state.draft.extensions).toHaveLength(1)
  })
  it('卡片可以跨栏移动、重排和编辑，localKey 与原 itemId 保持；删除再创建同文卡仍 dirty', () => {
    let state = initSettingReview(pendingSetting())
    const key = state.draft.world[0]!.localKey
    state = reduceSettingReview(state, { type: 'move-item', key, target: 'characters' })
    expect(state.draft.world).toEqual([])
    expect(state.draft.characters[1]).toMatchObject({ localKey: key, itemId: 'world-1' })
    state = reduceSettingReview(state, { type: 'reorder-item', key, direction: -1 })
    state = reduceSettingReview(state, { type: 'edit-item', key, field: 'title', value: '新的海港' })
    expect(toSettingSubmission(state).content.characters[0]!.title).toBe('新的海港')
    state = reduceSettingReview(state, { type: 'remove-item', key })
    state = reduceSettingReview(state, { type: 'add-item', target: 'world' })
    const newKey = state.draft.world[0]!.localKey
    state = reduceSettingReview(state, { type: 'edit-item', key: newKey, field: 'title', value: '海港' })
    state = reduceSettingReview(state, { type: 'edit-item', key: newKey, field: 'content', value: '每晚闭港。' })
    expect(toSettingSubmission(state).content.world).toEqual([{ title: '海港', content: '每晚闭港。' }])
    expect(isSettingDirty(state)).toBe(true)
    expect(JSON.stringify(toSettingSubmission(state))).not.toContain('localKey')
  })
  it('编辑保持 pending 基线隔离；改回原文不再 dirty，预览切换不保存', () => {
    const baseline = pendingSetting()
    let state = initSettingReview(baseline)
    state = reduceSettingReview(state, { type: 'overview', value: '作者的改稿' })
    expect(toSettingSubmission(state).content.overview).toBe('作者的改稿')
    expect(baseline.content.overview).toBe('海港里的故事')
    expect(state.baseline.content.overview).toBe('海港里的故事')
    expect(isSettingDirty(state)).toBe(true)
    state = reduceSettingReview(state, { type: 'overview', value: '海港里的故事' })
    state = reduceSettingReview(state, { type: 'mode', mode: 'edit' })
    expect(isSettingDirty(state)).toBe(false)
    expect(toSettingSubmission(state)).toEqual({ content: baseline.content, expectedHeadVersion: 1 })
  })
})
