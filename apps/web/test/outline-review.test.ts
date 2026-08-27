import { describe, it, expect } from 'vitest'
import type { OutlineContent } from '@agent4novel/contracts'
import {
  addArc,
  addSegment,
  approveSucceeded,
  beginApprove,
  beginSave,
  commandFailed,
  editArc,
  editSegment,
  initReview,
  isDirty,
  moveArc,
  moveSegment,
  removeArc,
  removeSegment,
  savePayload,
  saveSucceeded,
} from '../src/outline-review.js'

function seg(id: string, title = '剧情点') {
  return { segmentId: id, title, summary: '概要', outcome: '落点' }
}

function arc(id: string, segCount = 2) {
  return {
    arcId: id,
    title: `弧线${id}`,
    conflict: '冲突',
    development: '发展',
    resolution: '解决',
    segments: Array.from({ length: segCount }, (_, j) => seg(`${id}-seg-${j + 1}`)),
  }
}

const content: OutlineContent = { arcs: [arc('a1'), arc('a2'), arc('a3')] }

describe('outline-review 纯映射(#4)', () => {
  it('init:draft = baseline,不脏不忙', () => {
    const s = initReview(content, 1)
    expect(s.draft).toEqual(content)
    expect(s.headVersion).toBe(1)
    expect(isDirty(s)).toBe(false)
  })

  it('editArc/editSegment 只动 draft,不动 baseline,且标 dirty', () => {
    let s = initReview(content, 1)
    s = editArc(s, 0, { title: '改名弧线' })
    s = editSegment(s, 0, 1, { outcome: '新落点' })
    expect(s.draft.arcs[0]!.title).toBe('改名弧线')
    expect(s.draft.arcs[0]!.segments[1]!.outcome).toBe('新落点')
    expect(s.baseline.arcs[0]!.title).not.toBe('改名弧线')
    expect(isDirty(s)).toBe(true)
  })

  it('编辑不能改 id(类型外的强转也被运行时守住)', () => {
    let s = initReview(content, 1)
    s = editArc(s, 0, { arcId: 'hacked' } as never)
    s = editSegment(s, 0, 0, { segmentId: 'hacked' } as never)
    expect(s.draft.arcs[0]!.arcId).toBe('a1')
    expect(s.draft.arcs[0]!.segments[0]!.segmentId).toBe('a1-seg-1')
  })

  it('增删剧情点/弧线;新增项无 id(交 server 补注入)', () => {
    let s = initReview(content, 1)
    s = addSegment(s, 0)
    expect(s.draft.arcs[0]!.segments).toHaveLength(3)
    expect(s.draft.arcs[0]!.segments[2]!.segmentId).toBeUndefined()

    s = removeSegment(s, 0, 0)
    expect(s.draft.arcs[0]!.segments.map((x) => x.segmentId)).toEqual(['a1-seg-2', undefined])

    s = addArc(s)
    expect(s.draft.arcs).toHaveLength(4)
    expect(s.draft.arcs[3]!.arcId).toBeUndefined()
    expect(s.draft.arcs[3]!.segments).toHaveLength(2) // schema 下限

    s = removeArc(s, 1)
    expect(s.draft.arcs.map((a) => a.arcId)).toEqual(['a1', 'a3', undefined])
  })

  it('上下移:交换位置且 id 跟随(标识不随位置变)', () => {
    let s = initReview(content, 1)
    s = moveSegment(s, 0, 0, 1)
    expect(s.draft.arcs[0]!.segments.map((x) => x.segmentId)).toEqual(['a1-seg-2', 'a1-seg-1'])
    s = moveArc(s, 2, -1)
    expect(s.draft.arcs.map((a) => a.arcId)).toEqual(['a1', 'a3', 'a2'])
    // 越界移动 = no-op(同引用)
    expect(moveArc(s, 0, -1)).toBe(s)
    expect(moveSegment(s, 0, 0, -1)).toBe(s)
  })

  it('savePayload = 整棵 draft 树', () => {
    let s = initReview(content, 1)
    s = editArc(s, 1, { title: '改过的' })
    expect(savePayload(s).arcs[1]!.title).toBe('改过的')
  })

  it('busy 互斥:保存/通过期间编辑被忽略;无脏不保存', () => {
    let s = initReview(content, 1)
    expect(beginSave(s)).toBe(s) // 不脏,no-op
    s = editArc(s, 0, { title: 'x' })
    const saving = beginSave(s)
    expect(saving.saving).toBe(true)
    expect(editArc(saving, 0, { title: 'y' })).toBe(saving)
    expect(beginApprove(saving)).toBe(saving)
    const approving = beginApprove(s)
    expect(approving.approving).toBe(true)
    expect(beginSave(approving)).toBe(approving)
  })

  it('saveSucceeded:baseline/draft 换成 server 规整内容(id 补齐),headVersion 更新,dirty 清空', () => {
    let s = initReview(content, 1)
    s = addSegment(s, 0)
    s = beginSave(s)
    const normalized: OutlineContent = {
      arcs: content.arcs.map((a, i) =>
        i === 0 ? { ...a, segments: [...a.segments, seg('a1-seg-3', '新')] } : a,
      ),
    }
    s = saveSucceeded(s, normalized, 2)
    expect(s.headVersion).toBe(2)
    expect(s.draft).toEqual(normalized)
    expect(isDirty(s)).toBe(false)
    expect(s.notice).toBe('已保存')
  })

  it('409:draft 保留 + conflict;其他错误只复位 busy', () => {
    let s = initReview(content, 1)
    s = editArc(s, 0, { title: '我的心血' })
    s = beginSave(s)
    s = commandFailed(s, 'version-conflict')
    expect(s.conflict).toBe(true)
    expect(s.saving).toBe(false)
    expect(s.draft.arcs[0]!.title).toBe('我的心血')

    s = beginApprove(s)
    s = commandFailed(s, 'llm-unavailable')
    expect(s.conflict).toBe(false)
    expect(s.approving).toBe(false)
  })

  it('approveSucceeded:提示已通过,内容不变(调用方刷新读模型)', () => {
    let s = initReview(content, 1)
    s = beginApprove(s)
    s = approveSucceeded(s)
    expect(s.approving).toBe(false)
    expect(s.notice).toBe('已通过')
    expect(s.draft).toEqual(content)
  })
})
