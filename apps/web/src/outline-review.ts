import type { OutlineContent, OutlineDraft } from '@agent4novel/contracts'

// 大纲 review 的纯状态/command 映射(#4,镜像 creative-compare):核心风险(增删改/上下移、
// 保存载荷、409 保留 dirty)全部落在这里,纯函数 + vitest 覆盖,不引浏览器 E2E。
// 不变量:已有项以 arcId/segmentId 标识且不可编辑;新增项无 id,提交时由 server 补注入。
// 树内引用用「动作发生时的下标」(命令同步执行,下标即此刻位置;React key 用 id ?? 下标兜底)。

export type ReviewState = {
  /** server 最新版大纲(baseline,保存成功后换成 server 规整后的内容) */
  baseline: OutlineContent
  /** outline 产物最新版本号(save 的 expectedHeadVersion) */
  headVersion: number
  /** 本地编辑中的大纲树(新项无 id,见 OutlineDraft) */
  draft: OutlineDraft
  dirty: boolean
  saving: boolean
  approving: boolean
  /** 409(version-conflict)后保留 dirty edits 并提示 */
  conflict: boolean
  /** 一次性提示(已保存/已通过) */
  notice: string | null
}

export function initReview(content: OutlineContent, headVersion: number): ReviewState {
  return {
    baseline: content,
    headVersion,
    draft: content,
    dirty: false,
    saving: false,
    approving: false,
    conflict: false,
    notice: null,
  }
}

export function isDirty(s: ReviewState): boolean {
  return s.dirty
}

const busy = (s: ReviewState) => s.saving || s.approving

// 编辑落点统一入口:换 draft、标 dirty、清提示
function edit(s: ReviewState, arcs: OutlineDraft['arcs']): ReviewState {
  if (busy(s)) return s
  return { ...s, draft: { arcs }, dirty: true, conflict: false, notice: null }
}

type ArcPatch = Partial<{ title: string; conflict: string; development: string; resolution: string }>
type SegmentPatch = Partial<{ title: string; summary: string; outcome: string }>

// 编辑弧线字段(patch 类型上不含 arcId——不允许改标识)
export function editArc(s: ReviewState, arcIndex: number, patch: ArcPatch): ReviewState {
  const arc = s.draft.arcs[arcIndex]
  if (!arc) return s
  return edit(
    s,
    s.draft.arcs.map((a, i) => {
      if (i !== arcIndex) return a
      const next = { ...a, ...patch }
      if (a.arcId) next.arcId = a.arcId
      return next
    }),
  )
}

export function editSegment(
  s: ReviewState,
  arcIndex: number,
  segIndex: number,
  patch: SegmentPatch,
): ReviewState {
  const arc = s.draft.arcs[arcIndex]
  if (!arc?.segments[segIndex]) return s
  return edit(
    s,
    s.draft.arcs.map((a, i) =>
      i !== arcIndex
        ? a
        : {
            ...a,
            segments: a.segments.map((seg, j) => {
              if (j !== segIndex) return seg
              const next = { ...seg, ...patch }
              if (seg.segmentId) next.segmentId = seg.segmentId
              return next
            }),
          },
    ),
  )
}

// 新增:空字段 + 无 id(保存时 server 校验非空、补注入 id);新弧线带 2 个空剧情点(schema 下限)
export function addArc(s: ReviewState): ReviewState {
  return edit(s, [
    ...s.draft.arcs,
    {
      title: '',
      conflict: '',
      development: '',
      resolution: '',
      segments: [
        { title: '', summary: '', outcome: '' },
        { title: '', summary: '', outcome: '' },
      ],
    },
  ])
}

export function removeArc(s: ReviewState, arcIndex: number): ReviewState {
  return edit(
    s,
    s.draft.arcs.filter((_, i) => i !== arcIndex),
  )
}

export function addSegment(s: ReviewState, arcIndex: number): ReviewState {
  return edit(
    s,
    s.draft.arcs.map((a, i) =>
      i !== arcIndex ? a : { ...a, segments: [...a.segments, { title: '', summary: '', outcome: '' }] },
    ),
  )
}

export function removeSegment(s: ReviewState, arcIndex: number, segIndex: number): ReviewState {
  return edit(
    s,
    s.draft.arcs.map((a, i) =>
      i !== arcIndex ? a : { ...a, segments: a.segments.filter((_, j) => j !== segIndex) },
    ),
  )
}

function move<T>(items: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir
  if (index < 0 || to < 0 || index >= items.length || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item!)
  return next
}

export function moveArc(s: ReviewState, arcIndex: number, dir: -1 | 1): ReviewState {
  const arcs = move(s.draft.arcs, arcIndex, dir)
  if (arcs === s.draft.arcs) return s
  return edit(s, arcs)
}

export function moveSegment(s: ReviewState, arcIndex: number, segIndex: number, dir: -1 | 1): ReviewState {
  const arc = s.draft.arcs[arcIndex]
  if (!arc) return s
  const segments = move(arc.segments, segIndex, dir)
  if (segments === arc.segments) return s
  return edit(
    s,
    s.draft.arcs.map((a, i) => (i !== arcIndex ? a : { ...a, segments })),
  )
}

// 保存载荷:整棵 draft 树(新项无 id,交 server 规整),永远 pending
export function savePayload(s: ReviewState): OutlineDraft {
  return s.draft
}

export function beginSave(s: ReviewState): ReviewState {
  if (busy(s) || !s.dirty) return s
  return { ...s, saving: true, notice: null }
}

export function beginApprove(s: ReviewState): ReviewState {
  if (busy(s)) return s
  return { ...s, approving: true, notice: null }
}

// 保存成功:server 返回规整后内容(id 已补齐)→ baseline 与 draft 同步换新,dirty 清空
export function saveSucceeded(
  s: ReviewState,
  content: OutlineContent,
  newHeadVersion: number,
): ReviewState {
  return {
    ...s,
    baseline: content,
    draft: content,
    headVersion: newHeadVersion,
    dirty: false,
    saving: false,
    notice: '已保存',
  }
}

// 通过成功:由调用方刷新读模型(通过后 outline-approved 只读)
export function approveSucceeded(s: ReviewState): ReviewState {
  return { ...s, approving: false, notice: '已通过' }
}

// 失败:409 → conflict=true 且 draft 原样保留;其他错误只复位 busy
export function commandFailed(s: ReviewState, code?: string): ReviewState {
  return {
    ...s,
    saving: false,
    approving: false,
    conflict: code === 'version-conflict',
    notice: null,
  }
}
