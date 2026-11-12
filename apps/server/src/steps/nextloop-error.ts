export type NextloopUsage = { inputTokens?: number; outputTokens?: number }
export type NextloopFailureCode = 'llm-timeout' | 'llm-invalid-output' | 'llm-unavailable'

export class NextloopError extends Error {
  readonly name = 'NextloopError'
  constructor(
    readonly code: NextloopFailureCode,
    readonly retryable: boolean,
    readonly usage?: NextloopUsage,
    readonly finishReason?: string,
  ) {
    super('Nextloop generation failed')
  }
}
