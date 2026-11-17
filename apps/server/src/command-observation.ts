import type { BeatExecutionObservation, ProseExecutionObservation } from '@agent4novel/contracts'
import { KnownError } from './errors.js'

type Stage = NonNullable<BeatExecutionObservation['failureStage'] | ProseExecutionObservation['failureStage']>

const prewriteErrorCodes = ['version-conflict', 'upstream-changed', 'artifact-already-approved', 'work-not-found']

export function commandFailureObservation(cause: unknown, failureStage: Stage): {
  writeOutcome: 'unknown' | 'not-committed'
  failureStage: Stage
} {
  const prewrite = cause instanceof KnownError && prewriteErrorCodes.includes(cause.code)
  return {
    writeOutcome: failureStage === 'response' || (failureStage === 'commit' && !prewrite) ? 'unknown' : 'not-committed',
    failureStage,
  }
}
