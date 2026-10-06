// 已知业务错误:code 供路由层映射 HTTP 状态(替代 message 前缀匹配),message 供人读。
// retryable 供 web 决定要不要给「重试」;attemptId 串联日志(同一次步骤尝试)。
import type { BeatInputBudget, ProseInputBudget } from '@agent4novel/contracts'
export type KnownErrorCode =
  | 'invalid-input'
  | 'bad-example-invalid'
  | 'bad-example-not-found'
  | 'config-invalid'
  | 'agent-file-unavailable'
  | 'work-not-found'
  | 'artifact-not-found'
  | 'advance-in-progress'
  | 'chapter-not-ready'
  | 'version-conflict'
  | 'upstream-changed'
  | 'artifact-already-approved'
  | 'setting-approval-required'
  | 'setting-gate-not-ready'
  | 'beat-approval-required'
  | 'beat-gate-not-ready'
  | 'prose-approval-required'
  | 'prose-gate-not-ready'
  | 'input-budget-exceeded'
  | 'direction-not-selected'
  | 'llm-invalid-output'
  | 'llm-unavailable'
  | 'llm-timeout'

export class KnownError extends Error {
  readonly code: KnownErrorCode
  readonly retryable: boolean
  readonly attemptId?: string
  readonly inputBudget?: BeatInputBudget | ProseInputBudget
  constructor(
    code: KnownErrorCode,
    message: string,
    opts?: { retryable?: boolean; attemptId?: string; inputBudget?: BeatInputBudget | ProseInputBudget },
  ) {
    super(message)
    this.code = code
    this.retryable = opts?.retryable ?? false
    this.attemptId = opts?.attemptId
    this.inputBudget = opts?.inputBudget
  }
}
