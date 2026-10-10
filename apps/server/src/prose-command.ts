import { randomUUID } from 'node:crypto'
import { proseCommandObservationSchema } from '@agent4novel/contracts'
import type { Artifact, ProseExecutionObservation, ProseOperation, ChapterRegenerationBinding } from '@agent4novel/contracts'
import { KnownError } from './errors.js'
import { z } from 'zod'
import { currentRequest, recordCommand } from './steps/telemetry.js'

type Stage = NonNullable<ProseExecutionObservation['failureStage']>
export type ProseExecution = { stage: Stage }
export function proseFailureCode(cause: unknown, stage: Stage): string {
  if (stage === 'response') return 'internal-error'
  return cause instanceof KnownError ? cause.code : cause instanceof z.ZodError
    ? (stage === 'output' || stage === 'model' ? 'llm-invalid-output' : 'invalid-content') : 'internal-error'
}
export class ProseCommandError extends Error {
  constructor(readonly cause: unknown, readonly command: ProseExecutionObservation) { super('prose command failed') }
}
export function proseResponseError(workId: string, committed: ProseExecutionObservation, cause: unknown): ProseCommandError {
  const { resultHead: _resultHead, ...executed } = committed
  const request = currentRequest()
  const command: ProseExecutionObservation = { ...executed, writeOutcome: 'unknown', failureStage: 'response',
    latencyMs: request ? Date.now() - request.startedAt : executed.latencyMs }
  recordCommand(workId, command, proseFailureCode(cause, 'response'))
  return new ProseCommandError(cause, command)
}
export async function observeProse<T extends Artifact>(
  workId: string, operation: ProseOperation, expectedHead: ProseExecutionObservation['expectedHead'],
  run: (execution: ProseExecution) => T | Promise<T>,
  chapter = 1, regeneration?: ChapterRegenerationBinding,
): Promise<{ artifact: T; command: ProseExecutionObservation }> {
  const request = currentRequest()
  const started = Date.now()
  const cursor = request?.telemetry.length ?? 0
  const execution: ProseExecution = { stage: 'precondition' }
  const base = () => ({
    kind: 'execution-result' as const, requestId: request?.requestId ?? randomUUID(), operation,
    target: { workId, kind: 'prose' as const, chapter }, expectedHead, ...(regeneration ? { regeneration } : {}),
    executionMode: request?.executionMode ?? 'demo' as const, latencyMs: Date.now() - started,
    attemptIds: request?.telemetry.slice(cursor).filter(t => t.stepId === 'prose').map(t => t.attemptId) ?? [],
  })
  try {
    const artifact = await run(execution)
    execution.stage = 'response'
    const command = proseCommandObservationSchema.parse({
      ...base(), writeOutcome: 'committed',
      resultHead: { artifactId: artifact.id, version: artifact.version, humanStatus: artifact.humanStatus },
    }) as ProseExecutionObservation
    recordCommand(workId, command, 'ok')
    return { artifact, command }
  } catch (cause) {
    if (cause instanceof KnownError && cause.code === 'input-budget-exceeded') execution.stage = 'input'
    if (proseFailureCode(cause, execution.stage) === 'llm-invalid-output') execution.stage = 'output'
    const prewrite = cause instanceof KnownError && ['version-conflict', 'upstream-changed', 'artifact-already-approved', 'work-not-found'].includes(cause.code)
    const command: ProseExecutionObservation = {
      ...base(), writeOutcome: execution.stage === 'response' || (execution.stage === 'commit' && !prewrite) ? 'unknown' : 'not-committed',
      failureStage: execution.stage,
    }
    recordCommand(workId, command, proseFailureCode(cause, execution.stage))
    throw new ProseCommandError(cause, command)
  }
}
