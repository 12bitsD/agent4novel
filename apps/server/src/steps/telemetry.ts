import type { LlmTelemetry } from '@agent4novel/contracts'

// LLM 遥测账本(#14):进程内环形缓冲,生命周期=进程生命周期(同 store 的阶段假设)。
// advance 路由在开始/结束各取一次 cursor,把本次推进期间的记录内联进响应;
// GET /works/:id/telemetry 供事后回看。
const CAPACITY = 1000
let seq = 0
type Entry = { seq: number; workId: string } & LlmTelemetry
const entries: Entry[] = []

export function recordTelemetry(workId: string, t: LlmTelemetry): void {
  entries.push({ seq: ++seq, workId, ...t })
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY)
}

export function telemetryCursor(): number {
  return seq
}

export function telemetryFor(workId: string, afterSeq = 0): LlmTelemetry[] {
  return entries
    .filter((e) => e.workId === workId && e.seq > afterSeq)
    .map(({ seq: _seq, workId: _workId, ...t }) => t)
}

// 测试专用:清空账本
export function resetTelemetry(): void {
  entries.length = 0
  seq = 0
}
