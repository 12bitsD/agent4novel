import { randomUUID } from 'node:crypto'
import { beatCommandObservationSchema } from '@agent4novel/contracts'
import type { Artifact, BeatExecutionObservation, BeatOperation } from '@agent4novel/contracts'
import { KnownError } from './errors.js'
import { z } from 'zod'
import { currentRequest, recordCommand } from './steps/telemetry.js'

type Stage = NonNullable<BeatExecutionObservation['failureStage']>
export type BeatExecution = { stage: Stage }
export function beatFailureCode(cause: unknown, stage: Stage): string {
  return cause instanceof KnownError ? cause.code : cause instanceof z.ZodError
    ? (stage === 'output' || stage === 'model' ? 'llm-invalid-output' : 'invalid-content') : 'internal-error'
}
export class BeatCommandError extends Error {
  constructor(readonly cause: unknown, readonly command: BeatExecutionObservation) { super('beat command failed') }
}
export async function observeBeat<T extends Artifact>(
  workId: string, operation: BeatOperation, expectedHead: BeatExecutionObservation['expectedHead'],
  run: (execution: BeatExecution) => T | Promise<T>,
): Promise<{ artifact: T; command: BeatExecutionObservation }> {
  const request = currentRequest()
  const started = Date.now()
  const cursor = request?.telemetry.length ?? 0
  const execution: BeatExecution = { stage: 'precondition' }
  const base = () => ({
    kind: 'execution-result' as const, requestId: request?.requestId ?? randomUUID(), operation,
    target: { workId, kind: 'beat' as const, chapter: 1 as const }, expectedHead,
    executionMode: request?.executionMode ?? 'demo' as const, latencyMs: Date.now() - started,
    attemptIds: request?.telemetry.slice(cursor).filter(t => t.stepId === 'beat').map(t => t.attemptId) ?? [],
  })
  try {
    const artifact = await run(execution)
    execution.stage = 'response'
    const command = beatCommandObservationSchema.parse({
      ...base(), writeOutcome: 'committed',
      resultHead: { artifactId: artifact.id, version: artifact.version, humanStatus: artifact.humanStatus },
    }) as BeatExecutionObservation
    recordCommand(workId, command, 'ok')
    return { artifact, command }
  } catch (cause) {
    if (cause instanceof KnownError && cause.code === 'input-budget-exceeded') execution.stage = 'input'
    if (beatFailureCode(cause, execution.stage) === 'llm-invalid-output') execution.stage = 'output'
    const prewrite = cause instanceof KnownError && ['version-conflict', 'upstream-changed', 'artifact-already-approved', 'work-not-found'].includes(cause.code)
    const command: BeatExecutionObservation = {
      ...base(), writeOutcome: execution.stage === 'response' || (execution.stage === 'commit' && !prewrite) ? 'unknown' : 'not-committed',
      failureStage: execution.stage,
    }
    recordCommand(workId, command, beatFailureCode(cause, execution.stage))
    throw new BeatCommandError(cause, command)
  }
}
