import { commandSummarySchema, diagnosticResponseSchema } from '@agent4novel/contracts'
import type { LlmTelemetry, BeatCommandObservation, CommandSummary, DiagnosticQuery } from '@agent4novel/contracts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { safeLog } from '../safe-log.js'

type RequestScope = { requestId: string; executionMode: 'demo' | 'live'; telemetry: LlmTelemetry[]; startedAt: number }
const requests = new AsyncLocalStorage<RequestScope>()
export const currentRequest = () => requests.getStore()
export function withRequest<T>(requestId: string, demo: boolean, run: (scope: RequestScope) => T): T {
  const scope: RequestScope = { requestId, executionMode: demo ? 'demo' : 'live', telemetry: [], startedAt: Date.now() }
  return requests.run(scope, () => run(scope))
}

// LLM 遥测账本(#14):进程内环形缓冲,生命周期=进程生命周期(同 store 的阶段假设)。
// advance 路由在开始/结束各取一次 cursor,把本次推进期间的记录内联进响应;
// GET /works/:id/telemetry 供事后回看。
const CAPACITY = 1000
let seq = 0
type Entry = { seq: number; workId: string } & LlmTelemetry
const entries: Entry[] = []
let commandSeq = 0
let processInstanceId = randomUUID()
const commands: Array<{ workId: string; seq: number } & CommandSummary> = []

export function recordCommand(workId: string, command: BeatCommandObservation, code: string): void {
  try {
    const summary = commandSummarySchema.parse({ command, code, recordedAt: new Date().toISOString() })
    commands.push({ workId, seq: ++commandSeq, ...summary })
    if (commands.length > CAPACITY) commands.splice(0, commands.length - CAPACITY)
    safeLog({ event: 'beat.command', ...summary })
  } catch { /* diagnostic validation/sink failures never undo a command */ }
}
export function diagnosticsFor(workId: string, query: DiagnosticQuery = {}) {
  const windowOf = (items: Array<{ seq: number }>, latest: number) => ({
    capacity: 1000 as const, oldestSeq: items[0]?.seq ?? null, latestSeq: items.at(-1)?.seq ?? null, truncated: latest > CAPACITY,
  })
  return diagnosticResponseSchema.parse({
    workId,
    telemetry: telemetryFor(workId).filter(t => (!query.requestId || t.requestId === query.requestId) && (!query.attemptId || t.attemptId === query.attemptId)),
    commands: commands.filter(c => c.workId === workId && (!query.requestId || c.command.requestId === query.requestId)
      && (!query.attemptId || c.command.attemptIds.includes(query.attemptId))).map(({ workId: _workId, seq: _seq, ...summary }) => summary),
    window: { processInstanceId, retention: 'process-memory', llm: windowOf(entries, seq), commands: windowOf(commands, commandSeq) },
  })
}

export function recordTelemetry(workId: string, t: LlmTelemetry): void {
  try {
  const scope = currentRequest()
  const record = structuredClone({ ...t, ...(scope ? { requestId: scope.requestId } : {}) })
  if (scope && scope.telemetry.length < CAPACITY) scope.telemetry.push(record)
  entries.push({ seq: ++seq, workId, ...record })
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY)
  } catch { /* diagnostic storage is best effort */ }
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
  commands.length = 0
  commandSeq = 0
  processInstanceId = randomUUID()
}
