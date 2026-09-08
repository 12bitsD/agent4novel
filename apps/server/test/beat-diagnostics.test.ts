import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnosticsFor, recordCommand, recordTelemetry, resetTelemetry, withRequest } from '../src/steps/telemetry.js'

afterEach(() => { resetTelemetry(); vi.restoreAllMocks() })
describe('bounded command diagnostics', () => {
  it('keeps exact request-local telemetry when other work evicts the global window', async () => {
    resetTelemetry()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const id = '11111111-1111-4111-8111-111111111111'
    const telemetry = { stepId: 'beat', attemptId: 'own', model: 'fake', ok: true, latencyMs: 1, promptChars: 1, promptHash: 'hash', systemHash: 'hash' }
    let entered!: () => void
    let release!: () => void
    const began = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    const own = withRequest(id, false, async scope => {
      recordTelemetry('work-own', telemetry)
      entered()
      await wait
      return scope.telemetry
    })
    await began
    const before = diagnosticsFor('work-own')
    for (let i = 0; i < 1001; i++) {
      recordTelemetry('work-other', { ...telemetry, attemptId: `other-${i}` })
      recordCommand('work-other', { kind: 'request-rejected', requestId: id, operation: 'approve-beat', executionMode: 'demo', latencyMs: 0, writeOutcome: 'not-committed', failureStage: 'request', attemptIds: [] }, 'bad-json')
    }
    release()
    expect(await own).toEqual([{ ...telemetry, requestId: id }])
    expect(diagnosticsFor('work-own', { requestId: id })).toMatchObject({ telemetry: [], commands: [], window: { llm: { capacity: 1000, oldestSeq: 3, latestSeq: 1002, truncated: true }, commands: { oldestSeq: 2, latestSeq: 1001, truncated: true } } })
    expect(diagnosticsFor('work-other', { attemptId: 'other-1000' }).telemetry).toHaveLength(1)
    expect(diagnosticsFor('work-other').telemetry).toHaveLength(1000)
    resetTelemetry()
    const after = diagnosticsFor('work-own')
    expect(after.window.processInstanceId).not.toBe(before.window.processInstanceId)
    expect(after.window.llm).toMatchObject({ oldestSeq: null, latestSeq: null, truncated: false })
  })
})
