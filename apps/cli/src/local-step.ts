import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stepExperimentRequestSchema, stepExperimentResponseSchema } from '@agent4novel/contracts'
import { CliError } from './client.js'
import { readBoundedText, readRequestJson } from './request-file.js'
import { makeStepRecordRequest, markStepRecordUnknown, reserveStepRecordDir } from './step-record.js'

const FILE_BYTES = 1024 * 1024
const RESULT_BYTES = 8 * FILE_BYTES
const DEFAULT_STEP_TIMEOUT_MS = 920_000

function closeError(code: number | null, stdout: string, stderr: string): CliError | undefined {
  if (code === 0) return undefined
  if (stdout.trim()) {
    try {
      const response = stepExperimentResponseSchema.safeParse(JSON.parse(stdout))
      if (response.success && response.data.kind === 'failed') return undefined
    } catch { /* malformed worker output is not a valid failure response */ }
    return new CliError('Local step worker failed without a valid failure response', 'step-worker-failed')
  }
  let errorCode = 'step-worker-failed'
  try {
    const last: unknown = JSON.parse(stderr.trim().split('\n').at(-1) ?? '')
    if (typeof last === 'object' && last !== null && 'code' in last && typeof last.code === 'string'
      && ['invalid-input', 'payload-too-large', 'llm-config-invalid'].includes(last.code)) errorCode = last.code
  } catch { /* never echo worker stderr or provider text */ }
  return new CliError('Local step worker failed; check input and model configuration', errorCode)
}

// 文件只在 CLI 读取。provider 配置与推理只在 server 包的独立 worker 中运行。
export async function runLocalStep(stepId: string | undefined, flags: Record<string, string>, timeoutMs?: number) {
  if (flags.thinking !== undefined && !['on', 'off'].includes(flags.thinking)) {
    throw new CliError('--thinking must be on or off', 'invalid-input')
  }
  // Validate the file before applying flags: an override must not hide invalid or unknown config.
  const fromFile = stepExperimentRequestSchema.safeParse({ stepId,
    input: flags['input-file'] ? readRequestJson(flags['input-file'], FILE_BYTES, 'Step input') : { seed: readBoundedText(flags['seed-file']!, FILE_BYTES, 'Step seed'), upstream: {} },
    ...(flags['system-prompt-file'] ? { systemPrompt: readBoundedText(flags['system-prompt-file'], FILE_BYTES, 'Step system prompt') } : {}),
    ...(flags['config-file'] ? { config: readRequestJson(flags['config-file'], FILE_BYTES, 'Step config') } : {}),
  })
  if (!fromFile.success) throw new CliError('Invalid step experiment input or options', 'invalid-input')
  const overrides = {
    ...(flags.thinking !== undefined ? { thinking: flags.thinking === 'on' ? 'enabled' : 'disabled' } : {}),
    ...(flags.temperature !== undefined ? { temperature: Number(flags.temperature) } : {}),
    ...(flags['top-p'] !== undefined ? { topP: Number(flags['top-p']) } : {}),
  }
  const parsed = stepExperimentRequestSchema.safeParse({ ...fromFile.data,
    ...(Object.keys(overrides).length ? { config: { ...fromFile.data.config, ...overrides } } : {}),
  })
  if (!parsed.success) throw new CliError('Invalid step experiment input or options', 'invalid-input')
  let recordRequest: ReturnType<typeof makeStepRecordRequest> | undefined
  if (flags['record-dir'] !== undefined) {
    const dir = reserveStepRecordDir(flags['record-dir'])
    recordRequest = makeStepRecordRequest({
      dir,
      inputSource: flags['input-file'] ? 'input-file' : 'seed-file',
      inputPath: flags['input-file'] ?? flags['seed-file'] ?? null,
      systemPromptPath: flags['system-prompt-file'] ?? null,
      configPath: flags['config-file'] ?? null,
    })
  }
  const request = stepExperimentRequestSchema.parse({ ...parsed.data, ...(recordRequest ? { record: recordRequest } : {}) })
  const payload = JSON.stringify(request)
  if (Buffer.byteLength(payload) > FILE_BYTES) throw new CliError('Combined step experiment request exceeds 1 MiB', 'payload-too-large')
  const loader = new URL('../../server/node_modules/tsx/dist/loader.mjs', import.meta.url).href
  const worker = fileURLToPath(new URL('../../server/src/step-lab-main.ts', import.meta.url))
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', loader, worker], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    let closed = child.exitCode !== null || child.signalCode !== null
    let resolveClose: (() => void) | undefined
    const close = closed ? Promise.resolve() : new Promise<void>(resolve => { resolveClose = resolve })
    const markClosed = () => {
      closed = true
      resolveClose?.()
    }
    child.once('close', markClosed)
    child.once('error', () => { if (child.pid === undefined) markClosed() })
    const terminate = async () => {
      if (closed) return
      child.kill('SIGTERM')
      const escalation = setTimeout(() => { if (!closed) child.kill('SIGKILL') }, 100)
      try { await close } finally { clearTimeout(escalation) }
    }
    const cleanup = () => {
      clearTimeout(timer)
      process.off('SIGINT', sigint)
      process.off('SIGTERM', sigterm)
    }
    const finish = (error?: CliError, signal?: NodeJS.Signals) => {
      if (settled) return
      settled = true
      cleanup()
      if (!error) { resolve(stdout); return }
      if (recordRequest) markStepRecordUnknown(recordRequest, request.stepId, request.input, request.config?.model ?? 'unknown', error.code === 'network-error' ? 'cli-timeout' : 'worker-failed')
      void terminate().finally(() => {
        if (signal) process.kill(process.pid, signal)
        reject(error)
      })
    }
    const interrupt = (signal: NodeJS.Signals) => finish(new CliError('Step interrupted; the remote provider may still process the request', 'step-worker-failed'), signal)
    const sigint = () => interrupt('SIGINT')
    const sigterm = () => interrupt('SIGTERM')
    const timer = setTimeout(() => finish(new CliError('Step timed out; the remote provider may still process the request', 'network-error')), timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS)
    process.once('SIGINT', sigint)
    process.once('SIGTERM', sigterm)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > RESULT_BYTES) { finish(new CliError('Step response exceeds byte limit', 'invalid-response')); return }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-65536) })
    child.on('error', () => { finish(new CliError('Unable to start the local server worker', 'step-worker-failed')) })
    child.stdin.on('error', () => { /* close/error handlers report worker failures */ })
    child.on('close', code => { finish(closeError(code, stdout, stderr)) })
    child.stdin.end(payload)
  })
  let raw: unknown
  try { raw = JSON.parse(output) } catch { throw new CliError('Invalid step worker response', 'invalid-response') }
  const result = stepExperimentResponseSchema.safeParse(raw)
  if (!result.success || result.data.stepId !== stepId) throw new CliError('Invalid step worker response', 'invalid-response')
  if (result.data.kind === 'failed') {
    throw new CliError('Step experiment failed; inspect telemetry before retrying', result.data.code, undefined, result.data.retryable, undefined, undefined, result.data)
  }
  return result.data
}
