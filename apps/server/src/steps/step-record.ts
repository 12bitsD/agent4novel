import { randomUUID } from 'node:crypto'
import { chmod, link, lstat, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  stepExperimentRecordInputSchema,
  stepExperimentRecordInvocationSchema,
  stepExperimentRecordMetaSchema,
  stepExperimentRecordResultSchema,
} from '@agent4novel/contracts'
import type { StepExperimentRecordRequest, StepExperimentRecording, StepExperimentRequest } from '@agent4novel/contracts'

const FILES = { input: 'input.json', invocation: 'invocation.json', result: 'result.json', meta: 'meta.json' } as const

export class StepRecordError extends Error {
  readonly code = 'recording-failed'
  constructor(readonly reason: string) {
    super('step record could not be prepared or written')
    this.name = 'StepRecordError'
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function ensurePrivateDirectory(dir: string): Promise<void> {
  try {
    const entry = await lstat(dir)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new StepRecordError('record-directory-not-private')
    if ((entry.mode & 0o077) !== 0) throw new StepRecordError('record-directory-permissions')
  } catch (error) {
    if (error instanceof StepRecordError) throw error
    throw new StepRecordError(isNodeError(error, 'ENOENT') ? 'record-directory-missing' : 'record-directory-unreadable')
  }
}

async function writeJsonExclusive(dir: string, name: string, value: unknown): Promise<void> {
  const target = join(dir, name)
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`)
  try {
    try {
      await lstat(target)
      throw new StepRecordError(`record-file-collision:${name}`)
    } catch (error) {
      if (error instanceof StepRecordError) throw error
      if (!isNodeError(error, 'ENOENT')) throw error
    }
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    // rename(2) replaces an existing target on POSIX. A hard-link create is
    // atomic and fails with EEXIST instead, so a late collision cannot change
    // an existing record file.
    await link(temporary, target)
    await unlink(temporary)
    await chmod(target, 0o600)
  } catch (error) {
    try { await unlink(temporary) } catch { /* best effort cleanup only */ }
    if (error instanceof StepRecordError) throw error
    throw new StepRecordError(isNodeError(error, 'EEXIST') ? `record-file-collision:${name}` : `record-write-failed:${name}`)
  }
}

async function replaceJson(dir: string, name: string, value: unknown): Promise<void> {
  const target = join(dir, name)
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`)
  try {
    const existing = await lstat(target)
    if (!existing.isFile() || existing.isSymbolicLink()) throw new StepRecordError(`record-file-not-regular:${name}`)
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    await rename(temporary, target)
    await chmod(target, 0o600)
  } catch (error) {
    if (error instanceof StepRecordError) throw error
    throw new StepRecordError(isNodeError(error, 'ENOENT') ? `record-file-missing:${name}` : `record-write-failed:${name}`)
  }
}

const emptyInvocation = {
  formatVersion: 1 as const,
  captured: false,
  capturedAt: null,
  system: null,
  prompt: null,
  model: null,
  attemptId: null,
  effectiveConfig: null,
  generation: null,
  sdkOptions: null,
  maxOutputTokens: null,
  maxRetries: null,
  requestTimeoutMs: null,
}

export class StepRecorder {
  private constructor(
    private readonly request: StepExperimentRecordRequest,
    private readonly runId: string,
    private readonly stepId: StepExperimentRequest['stepId'],
    private readonly model: string,
    private readonly startedAt: string,
  ) {}

  static async start(args: {
    request: StepExperimentRecordRequest
    input: unknown
    runId: string
    stepId: StepExperimentRequest['stepId']
    model: string
  }): Promise<StepRecorder> {
    await ensurePrivateDirectory(args.request.dir)
    const recorder = new StepRecorder(args.request, args.runId, args.stepId, args.model, new Date().toISOString())
    const input = stepExperimentRecordInputSchema.parse({ formatVersion: 1, input: args.input, sources: args.request.sources })
    await writeJsonExclusive(args.request.dir, FILES.input, input)
    await writeJsonExclusive(args.request.dir, FILES.invocation, emptyInvocation)
    await writeJsonExclusive(args.request.dir, FILES.meta, recorder.meta(false, 'in-progress', null))
    return recorder
  }

  async captureInvocation(value: {
    system: string
    prompt: string
    model: string
    attemptId: string
    effectiveConfig: { model: string | null; directionCount: number | null; thinking: 'enabled' | 'disabled' | null; temperature: number | null; topP: number | null }
    generation: { thinking: 'enabled' | 'disabled' | null; temperature: number | null; topP: number | null }
    sdkOptions: { temperature: number | null; topP: number | null; providerOptions: unknown }
    maxOutputTokens: number
    maxRetries: number | null
    requestTimeoutMs: number
  }): Promise<void> {
    const invocation = stepExperimentRecordInvocationSchema.parse({ formatVersion: 1, captured: true, capturedAt: new Date().toISOString(), ...value })
    await replaceJson(this.request.dir, FILES.invocation, invocation)
  }

  async finish(args: {
    status: 'succeeded' | 'failed' | 'unknown'
    content: unknown
    code: string | null
    retryable: boolean | null
    telemetry: unknown[]
  }): Promise<StepExperimentRecording> {
    try {
      const result = stepExperimentRecordResultSchema.parse({
        formatVersion: 1,
        status: args.status,
        content: args.content,
        diagnostic: { code: args.code, retryable: args.retryable, error: null, telemetry: args.telemetry },
      })
      await writeJsonExclusive(this.request.dir, FILES.result, result)
      await replaceJson(this.request.dir, FILES.meta, this.meta(true, 'complete', new Date().toISOString()))
      return { status: 'complete', dir: this.request.dir, error: null }
    } catch (error) {
      return { status: 'failed', dir: this.request.dir, error: error instanceof StepRecordError ? error.reason : 'record-write-failed' }
    }
  }

  private meta(complete: boolean, status: 'in-progress' | 'complete' | 'incomplete', finishedAt: string | null) {
    return stepExperimentRecordMetaSchema.parse({
      formatVersion: 1,
      complete,
      status,
      runId: this.runId,
      stepId: this.stepId,
      executionMode: 'live',
      model: this.model,
      startedAt: this.startedAt,
      finishedAt,
      gitCommit: this.request.version.gitCommit,
      gitDirty: this.request.version.gitDirty,
      sources: this.request.sources,
      files: FILES,
    })
  }
}

const currentRecorder = new AsyncLocalStorage<StepRecorder>()
export function withStepRecorder<T>(recorder: StepRecorder, run: () => Promise<T>): Promise<T> {
  return currentRecorder.run(recorder, run)
}
export function currentStepRecorder(): StepRecorder | undefined {
  return currentRecorder.getStore()
}
