import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StepExperimentRecordRequest } from '@agent4novel/contracts'
import { CliError } from './client.js'

const FILES = { input: 'input.json', invocation: 'invocation.json', result: 'result.json', meta: 'meta.json' } as const

function safePathChain(target: string): void {
  const root = parse(target).root
  let current = dirname(target)
  while (true) {
    let entry
    try { entry = lstatSync(current) } catch { throw new CliError('Record directory parent must already exist', 'recording-path-invalid') }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new CliError('Record directory path contains an unsafe parent', 'recording-path-invalid')
    if (current === root) break
    current = dirname(current)
  }
}

export function reserveStepRecordDir(value: string): string {
  const target = resolve(value)
  if (target === parse(target).root) throw new CliError('Record directory must not be a filesystem root', 'recording-path-invalid')
  safePathChain(target)
  try {
    const existing = lstatSync(target)
    if (existing.isSymbolicLink()) throw new CliError('Record directory may not be a symlink', 'recording-path-invalid')
    throw new CliError('Record directory already exists; refusing to overwrite it', 'recording-collision')
  } catch (error) {
    if (error instanceof CliError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CliError('Unable to inspect record directory', 'recording-path-invalid')
  }
  try {
    mkdirSync(target, { mode: 0o700 })
    chmodSync(target, 0o700)
  } catch { throw new CliError('Unable to create private record directory', 'recording-path-invalid') }
  return target
}

function gitVersion(): { gitCommit: string | null; gitDirty: boolean | null } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
    return { gitCommit: /^[0-9a-f]{40}$/.test(commit) ? commit : null, gitDirty: dirty }
  } catch { return { gitCommit: null, gitDirty: null } }
}

export function makeStepRecordRequest(args: {
  dir: string
  inputSource: 'input-file' | 'seed-file'
  inputPath: string | null
  systemPromptPath: string | null
  configPath: string | null
}): StepExperimentRecordRequest {
  return {
    dir: resolve(args.dir),
    sources: {
      input: args.inputSource,
      inputPath: args.inputPath ? resolve(args.inputPath) : null,
      systemPromptPath: args.systemPromptPath ? resolve(args.systemPromptPath) : null,
      configPath: args.configPath ? resolve(args.configPath) : null,
    },
    version: gitVersion(),
  }
}

function readJson(path: string): Record<string, any> | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any> } catch { return undefined }
}

function writeJsonExclusive(dir: string, name: string, value: unknown): void {
  const target = join(dir, name)
  if (existsSync(target)) return
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, target)
    chmodSync(target, 0o600)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* best effort cleanup only */ }
    throw error
  }
}

function replaceJson(dir: string, name: string, value: unknown): void {
  const target = join(dir, name)
  const existing = lstatSync(target)
  if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('unsafe record file')
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, target)
    chmodSync(target, 0o600)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* best effort cleanup only */ }
    throw error
  }
}

export function markStepRecordUnknown(record: StepExperimentRecordRequest, stepId: string, input: unknown, model: string, code: string): void {
  try {
    const dirStat = lstatSync(record.dir)
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || (dirStat.mode & 0o077) !== 0) return
    const oldMeta = readJson(join(record.dir, FILES.meta))
    if (oldMeta?.complete === true && oldMeta.status === 'complete') return
    writeJsonExclusive(record.dir, FILES.input, { formatVersion: 1, input, sources: record.sources })
    writeJsonExclusive(record.dir, FILES.invocation, {
      formatVersion: 1, captured: false, capturedAt: null, system: null, prompt: null, model: null, attemptId: null,
      generation: null, sdkOptions: null, maxOutputTokens: null, maxRetries: null, requestTimeoutMs: null,
    })
    const existingResult = readJson(join(record.dir, FILES.result))
    if (!existingResult) writeJsonExclusive(record.dir, FILES.result, {
      formatVersion: 1, status: 'unknown', content: null,
      diagnostic: { code, retryable: null, error: null, telemetry: [] },
    })
    const meta = {
      formatVersion: 1, complete: false, status: 'incomplete',
      runId: oldMeta?.runId ?? null, stepId: oldMeta?.stepId ?? stepId, executionMode: 'live', model: oldMeta?.model ?? model,
      startedAt: oldMeta?.startedAt ?? new Date().toISOString(), finishedAt: new Date().toISOString(),
      gitCommit: oldMeta?.gitCommit ?? record.version.gitCommit, gitDirty: oldMeta?.gitDirty ?? record.version.gitDirty,
      sources: oldMeta?.sources ?? record.sources, files: FILES,
    }
    if (existsSync(join(record.dir, FILES.meta))) replaceJson(record.dir, FILES.meta, meta)
    else writeJsonExclusive(record.dir, FILES.meta, meta)
  } catch { /* preserve the CLI error; a partial directory is not a successful record */ }
}
