import { describe, expect, it } from 'vitest'
import { stepWorkerErrorCode } from '../src/step-lab-error.js'

describe('step worker top-level errors', () => {
  it('distinguishes model configuration failures from unexpected worker failures', () => {
    expect(stepWorkerErrorCode(Object.assign(new Error('invalid model'), { code: 'llm-config-invalid' }))).toBe('llm-config-invalid')
    expect(stepWorkerErrorCode(new Error('PRIVATE_WORKER_DETAIL'))).toBe('step-worker-failed')
    expect(stepWorkerErrorCode('PRIVATE_WORKER_DETAIL')).toBe('step-worker-failed')
  })
})
