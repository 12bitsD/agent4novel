export function stepWorkerErrorCode(error: unknown): 'llm-config-invalid' | 'step-worker-failed' {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'llm-config-invalid') return 'llm-config-invalid'
  return 'step-worker-failed'
}
