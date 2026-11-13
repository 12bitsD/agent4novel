import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
import { runLocalStep } from '../src/local-step.js'

afterEach(() => vi.restoreAllMocks())

function workerThatIgnoresSigterm() {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    pid: 12345, exitCode: null, signalCode: null, killed: false,
  })
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    if (signal === 'SIGKILL') {
      Object.assign(child, { signalCode: signal })
      queueMicrotask(() => child.emit('close', null, signal))
    }
    return true
  })
  return child
}

function seedFile() {
  const dir = mkdtempSync(join(tmpdir(), 'a4n-local-step-lifecycle-'))
  const file = join(dir, 'seed.txt')
  writeFileSync(file, 'synthetic lifecycle seed')
  return { dir, file }
}

describe('local step worker lifecycle', () => {
  it('escalates an ignored SIGTERM to SIGKILL and waits for close before rejecting', async () => {
    const { dir, file } = seedFile()
    try {
      const child = workerThatIgnoresSigterm()
      mocks.spawn.mockReturnValue(child)
      const result = runLocalStep('caption', { 'seed-file': file }, 10)
      await expect(result).rejects.toMatchObject({ code: 'network-error' })
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
      expect(child.signalCode).toBe('SIGKILL')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 1000)

  it('reaps the worker on a parent signal and restores default signal handling', async () => {
    const { dir, file } = seedFile()
    const exit = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const child = workerThatIgnoresSigterm()
      mocks.spawn.mockReturnValue(child)
      const result = runLocalStep('caption', { 'seed-file': file }, 10_000)
      await new Promise(resolve => setTimeout(resolve, 0))
      process.emit('SIGTERM')
      await expect(result).rejects.toMatchObject({ code: 'step-worker-failed' })
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
      expect(exit).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 1000)

  it('does not treat a runtime kill error as process close', async () => {
    const { dir, file } = seedFile()
    try {
      const child = workerThatIgnoresSigterm()
      const kill = child.kill
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        if (signal === 'SIGTERM') { child.emit('error', new Error('synthetic kill failure')); return false }
        return kill(signal)
      })
      mocks.spawn.mockReturnValue(child)
      const result = runLocalStep('caption', { 'seed-file': file }, 10)
      await expect(result).rejects.toMatchObject({ code: 'network-error' })
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
      expect(child.signalCode).toBe('SIGKILL')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 1000)

  it('rejects success or malformed stdout after a nonzero worker exit', async () => {
    const { dir, file } = seedFile()
    const success = {
      runId: 'experiment-success', stepId: 'caption', executionMode: 'live', model: 'kimi:kimi-k2.8-highspeed',
      kind: 'succeeded', content: { inputStage: '脑洞', summary: 'ok', elements: [], gaps: [] }, telemetry: [],
    }
    try {
      for (const payload of [JSON.stringify(success), '{malformed']) {
        const child = workerThatIgnoresSigterm()
        mocks.spawn.mockReturnValue(child)
        const result = runLocalStep('caption', { 'seed-file': file }, 10_000)
        void (child.stdout as PassThrough).end(`${payload}\n`)
        queueMicrotask(() => { Object.assign(child, { exitCode: 1 }); child.emit('close', 1, null) })
        await expect(result).rejects.toMatchObject({ code: 'step-worker-failed' })
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 1000)

  it('preserves a schema-valid application failure after a nonzero worker exit', async () => {
    const { dir, file } = seedFile()
    try {
      const child = workerThatIgnoresSigterm()
      mocks.spawn.mockReturnValue(child)
      const result = runLocalStep('caption', { 'seed-file': file }, 10_000)
      void (child.stdout as PassThrough).end(`${JSON.stringify({
        runId: 'experiment-failed', stepId: 'caption', executionMode: 'live', model: 'kimi:kimi-k2.8-highspeed',
        kind: 'failed', code: 'llm-invalid-output', retryable: true, telemetry: [],
      })}\n`)
      queueMicrotask(() => { Object.assign(child, { exitCode: 1 }); child.emit('close', 1, null) })
      await expect(result).rejects.toMatchObject({ code: 'llm-invalid-output' })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 1000)
})
