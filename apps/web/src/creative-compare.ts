import type { CreativeContent, CreativePack } from '@agent4novel/contracts'

// 创意海报的纯状态/command 映射(#3c 评审 #21):核心风险(tab↔directionId 绑定、
// 保存全部方向、选定当前方向、409 保留 dirty)全部落在这里,纯函数 + vitest 覆盖,不引浏览器 E2E。
// 不变量:方向永远以 directionId 标识(标题可重名、下标可变);directionId 不可编辑。

export type CompareState = {
  /** server 最新版的方向包(baseline) */
  packs: CreativePack[]
  /** creative 产物最新版本号(save/select 的 expectedHeadVersion) */
  headVersion: number
  /** 当前 tab(directionId) */
  activeId: string
  /** 本地编辑缓存:directionId → 编辑中的包 */
  drafts: Record<string, CreativePack>
  /** 有未保存编辑的 directionId */
  dirty: string[]
  saving: boolean
  selecting: boolean
  /** 409(version-conflict)后保留 dirty edits 并提示 */
  conflict: boolean
  /** 一次性提示(已保存/已选定) */
  notice: string | null
}

export function initCompare(content: CreativeContent, headVersion: number): CompareState {
  const first = content.directions[0]
  if (!first) throw new Error('creative content has no directions')
  return {
    packs: content.directions,
    headVersion,
    activeId: first.directionId,
    drafts: {},
    dirty: [],
    saving: false,
    selecting: false,
    conflict: false,
    notice: null,
  }
}

// 当前展示的包:有 draft 用 draft,否则 baseline
export function activePack(s: CompareState): CreativePack {
  return s.drafts[s.activeId] ?? s.packs.find((p) => p.directionId === s.activeId)!
}

export function isDirty(s: CompareState): boolean {
  return s.dirty.length > 0
}

export function switchTab(s: CompareState, directionId: string): CompareState {
  if (!s.packs.some((p) => p.directionId === directionId)) return s
  return { ...s, activeId: directionId, notice: null }
}

// 编辑当前方向的字段(patch 不含 directionId——类型上就不允许改标识)
export function editActive(s: CompareState, patch: Partial<Omit<CreativePack, 'directionId'>>): CompareState {
  if (s.saving || s.selecting) return s
  const current = activePack(s)
  const next: CreativePack = { ...current, ...patch, directionId: current.directionId }
  const dirty = s.dirty.includes(s.activeId) ? s.dirty : [...s.dirty, s.activeId]
  return {
    ...s,
    drafts: { ...s.drafts, [s.activeId]: next },
    dirty,
    conflict: false,
    notice: null,
  }
}

// saveAll 的载荷:全部方向(draft 覆盖 baseline),永远 pending
export function savePayload(s: CompareState): CreativeContent {
  return { directions: s.packs.map((p) => s.drafts[p.directionId] ?? p) }
}

export function beginSave(s: CompareState): CompareState {
  if (s.saving || s.selecting || !isDirty(s)) return s
  return { ...s, saving: true, notice: null }
}

export function beginSelect(s: CompareState): CompareState {
  if (s.saving || s.selecting) return s
  return { ...s, selecting: true, notice: null }
}

// 保存成功:server 落新版本(全部方向)→ baseline 换成本地编辑结果,dirty 清空
export function saveSucceeded(s: CompareState, newHeadVersion: number): CompareState {
  return {
    ...s,
    packs: savePayload(s).directions,
    headVersion: newHeadVersion,
    drafts: {},
    dirty: [],
    saving: false,
    notice: '已保存',
  }
}

// 选定成功:由调用方刷新读模型(选定后内容变单方向 approved)
export function selectSucceeded(s: CompareState): CompareState {
  return { ...s, selecting: false, notice: '已选定' }
}

// 失败:409 → conflict=true 且 drafts 原样保留;其他错误只复位 busy
export function commandFailed(s: CompareState, code?: string): CompareState {
  return {
    ...s,
    saving: false,
    selecting: false,
    conflict: code === 'version-conflict',
    notice: null,
  }
}
