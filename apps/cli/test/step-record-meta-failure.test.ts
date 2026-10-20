import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  stepExperimentRecordInputSchema,
  stepExperimentRecordInvocationSchema,
  stepExperimentRecordMetaSchema,
  stepExperimentRecordResultSchema,
} from '@agent4novel/contracts'
import { expect, it, vi } from 'vitest'
import { StepRecorder } from '../../server/src/steps/step-record.js'
import { markStepRecordUnknown } from '../src/step-record.js'

const renameFault = vi.hoisted(() => ({ armed: false, recordDir: '' }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (renameFault.armed && dirname(String(to)) === renameFault.recordDir && basename(String(to)) === 'meta.json') {
        renameFault.armed = false
        const error = new Error('synthetic final meta rename failure') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      }
      return actual.rename(from, to)
    },
  }
})

it('preserves a published result through final meta failure and real unknown finalization', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'a4n-step-record-m5-'))
  const recordDir = join(directory, 'run-m5')
  mkdirSync(recordDir, { mode: 0o700 })
  const input = { seed: 'M5 合成素材', upstream: {} }
  const record = {
    dir: recordDir,
    sources: { input: 'seed-file' as const, inputPath: '/synthetic/seed.txt', systemPromptPath: null, configPath: null },
    version: { gitCommit: null, gitDirty: null },
  }
  const content = { inputStage: '主线', summary: 'M5 合成结果', elements: [], gaps: [] }
  try {
    const recorder = await StepRecorder.start({
      request: record,
      input,
      runId: 'experiment-m5',
      stepId: 'caption',
      model: 'synthetic-model',
    })
    renameFault.recordDir = recordDir
    renameFault.armed = true
    const recording = await recorder.finish({ status: 'succeeded', content, code: null, retryable: null, telemetry: [] })
    expect(recording).toMatchObject({ status: 'failed', dir: recordDir })
    expect(recording.error).toBeTruthy()
    expect(renameFault.armed).toBe(false)

    const resultPath = join(recordDir, 'result.json')
    const publishedResult = readFileSync(resultPath, 'utf8')
    expect(stepExperimentRecordResultSchema.parse(JSON.parse(publishedResult))).toMatchObject({ status: 'succeeded', content })
    expect(stepExperimentRecordMetaSchema.parse(JSON.parse(readFileSync(join(recordDir, 'meta.json'), 'utf8')))).toMatchObject({
      complete: false,
      status: 'in-progress',
      finishedAt: null,
    })

    markStepRecordUnknown(record, 'caption', input, 'synthetic-model', 'worker-failed')

    expect(readFileSync(resultPath, 'utf8')).toBe(publishedResult)
    expect(stepExperimentRecordInputSchema.parse(JSON.parse(readFileSync(join(recordDir, 'input.json'), 'utf8'))).input).toEqual(input)
    expect(stepExperimentRecordInvocationSchema.parse(JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8')))).toMatchObject({ captured: false })
    expect(stepExperimentRecordResultSchema.parse(JSON.parse(readFileSync(resultPath, 'utf8')))).toMatchObject({
      status: 'succeeded',
      content,
      diagnostic: { code: null },
    })
    const meta = stepExperimentRecordMetaSchema.parse(JSON.parse(readFileSync(join(recordDir, 'meta.json'), 'utf8')))
    expect(meta).toMatchObject({
      complete: false,
      status: 'incomplete',
      runId: 'experiment-m5',
      stepId: 'caption',
      model: 'synthetic-model',
    })
    expect(meta.complete === true && meta.status === 'complete').toBe(false)
  } finally {
    renameFault.armed = false
    renameFault.recordDir = ''
    rmSync(directory, { recursive: true, force: true })
  }
})
