import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { settingArtifactSchema } from '@agent4novel/contracts'
import { initSettingReview, reduceSettingReview } from '../src/setting-review.js'
import SettingReview from '../src/pages/SettingReview.js'
import { ConfirmDialog } from '../src/ConfirmDialog.js'

const artifact = settingArtifactSchema.parse({
  id: 'a1', workId: 'w1', kind: 'setting', version: 1, humanStatus: 'pending', createdAt: 'today', content: {
    overview: '这是一份 **作者设定**。', world: [{ itemId: 'w1', title: '世界 <script>', content: '规则' }],
    characters: [{ itemId: 'c1', title: '人物', content: '动机' }], factions: [], relationships: [], extensions: [],
  },
})
const callbacks = { onAction() {}, onApprove() {}, onConfirm() {}, onRetry() {}, allowApprove: true }
describe('设定关卡页面', () => {
  it('已通过只能阅读；无提交权限、冲突或不确定阶段不开放编辑和新提交', () => {
    const approved = renderToStaticMarkup(<SettingReview {...callbacks} state={initSettingReview({ ...artifact, humanStatus: 'approved' })} />)
    expect(approved).not.toContain('编辑设定')
    expect(approved).not.toContain('<textarea')
    expect(approved).toContain('已通过')
    let state = reduceSettingReview(initSettingReview(artifact), { type: 'mode', mode: 'edit' })
    state = reduceSettingReview(state, { type: 'submit' })
    state = reduceSettingReview(state, { type: 'unknown', message: '超时' })
    state = reduceSettingReview(state, { type: 'readback-failed', message: '未确认' })
    const unknown = renderToStaticMarkup(<SettingReview {...callbacks} state={state} />)
    expect(unknown).toContain('重试同一份提交')
    expect(unknown).toContain('核对服务器结果')
    expect(unknown).toMatch(/<textarea[^>]*disabled=""/)
    expect(unknown).toMatch(/<button[^>]*disabled=""[^>]*>通过设定<\/button>/)
  })
  it('字段校验失败在编辑控件上关联错误，并为弹窗提供名称与描述', () => {
    let state = reduceSettingReview(initSettingReview(artifact), { type: 'overview', value: '' })
    state = reduceSettingReview(state, { type: 'submit' })
    const html = renderToStaticMarkup(<SettingReview {...callbacks} state={state} />)
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="setting-error-overview"')
    expect(html).toContain('data-setting-field="overview"')
    const dialog = renderToStaticMarkup(<ConfirmDialog title="尚未通过设定" description="当前修改只保存在本页，离开后将无法恢复。" cancelLabel="继续编辑" confirmLabel="放弃修改并离开" onCancel={() => {}} onConfirm={() => {}} />)
    expect(dialog).toContain('role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toContain('aria-labelledby=')
    expect(dialog).toContain('aria-describedby=')
    expect(dialog).toContain('继续编辑')
    expect(dialog).toContain('放弃修改并离开')
  })
  it('默认预览六栏目及总览 Markdown，通过入口常驻；编辑模式显示可访问字段和卡片操作', () => {
    const state = initSettingReview(artifact)
    const preview = renderToStaticMarkup(<SettingReview {...callbacks} state={state} />)
    expect(preview).toContain('<strong>作者设定</strong>')
    expect(preview).toContain('世界 &lt;script&gt;')
    for (const label of ['设定总览', '世界与运行规则', '人物', '势力与组织', '关系', '补充设定', '通过设定']) expect(preview).toContain(label)
    expect(preview).not.toContain('<textarea')
    const editing = renderToStaticMarkup(<SettingReview {...callbacks} state={reduceSettingReview(state, { type: 'mode', mode: 'edit' })} />)
    expect(editing).toContain('<textarea')
    expect(editing).toContain('新增卡片')
    expect(editing).toContain('移动到其他栏目')
    expect(editing).toContain('新增补充栏目')
    expect(editing).toContain('通过设定')
  })
})
