// 已知业务错误：code 供路由层映射 HTTP 状态（替代 message 前缀匹配），message 供人读
export type KnownErrorCode = 'work-not-found' | 'artifact-not-found' | 'no-pending-interview'

export class KnownError extends Error {
  readonly code: KnownErrorCode
  constructor(code: KnownErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
