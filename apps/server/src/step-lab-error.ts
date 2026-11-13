export function stepWorkerErrorCode(error: unknown): 'llm-config-invalid' | 'step-worker-failed' {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'llm-config-invalid'
    ? 'llm-config-invalid' : 'step-worker-failed'
}
