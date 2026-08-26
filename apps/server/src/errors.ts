// 已知业务错误:code 供路由层映射 HTTP 状态(替代 message 前缀匹配),message 供人读。
// retryable 供 web 决定要不要给「重试」;attemptId 串联日志(同一次步骤尝试)。
export type KnownErrorCode =
  | 'work-not-found'
  | 'artifact-not-found'
  | 'advance-in-progress'
  | 'version-conflict'
  | 'direction-not-selected'
  | 'llm-invalid-output'
  | 'llm-unavailable'
  | 'llm-timeout'

export class KnownError extends Error {
  readonly code: KnownErrorCode
  readonly retryable: boolean
  readonly attemptId?: string
  constructor(
    code: KnownErrorCode,
    message: string,
    opts?: { retryable?: boolean; attemptId?: string },
  ) {
    super(message)
    this.code = code
    this.retryable = opts?.retryable ?? false
    this.attemptId = opts?.attemptId
  }
}
