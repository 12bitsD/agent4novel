import { openSync, readSync, closeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stepExperimentRequestSchema, stepExperimentResponseSchema } from '@agent4novel/contracts'
import { CliError } from './client.js'

const FILE_BYTES = 1024 * 1024
const RESULT_BYTES = 8 * FILE_BYTES
const DEFAULT_STEP_TIMEOUT_MS = 920_000

function readBounded(path: string): string {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    const buffer = Buffer.alloc(FILE_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    if (length > FILE_BYTES) throw new CliError('Step experiment file exceeds 1 MiB', 'payload-too-large')
    return buffer.subarray(0, length).toString('utf8')
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('Unable to read step experiment file', 'usage')
  } finally { if (descriptor !== undefined) closeSync(descriptor) }
}

function readJson(path: string): unknown {
  const text = readBounded(path)
  try { return JSON.parse(text) } catch { throw new CliError('Step input must be valid JSON', 'invalid-input') }
}

// 文件只在 CLI 读取。provider 配置与推理只在 server 包的独立 worker 中运行。
export async function runLocalStep(stepId: string | undefined, flags: Record<string, string>, timeoutMs?: number) {
  if ('top-k' in flags) throw new CliError('--top-k is not supported by the documented LongCat-2.0 API; use --top-p instead', 'usage')
  if (!stepId || Object.values(flags).some(value => value.trim() === '') || Object.keys(flags).some(key => !['input-file', 'seed-file', 'system-prompt-file', 'config-file', 'timeout-ms', 'thinking', 'temperature', 'top-p'].includes(key))
    || Boolean(flags['input-file']) === Boolean(flags['seed-file'])) {
    throw new CliError('run-step requires a node and exactly one of --input-file or --seed-file; --url is not supported', 'usage')
  }
  if (flags.thinking !== undefined && !['on', 'off'].includes(flags.thinking)) {
    throw new CliError('--thinking must be on or off', 'invalid-input')
  }
  // Validate the file before applying flags: an override must not hide invalid or unknown config.
  const fromFile = stepExperimentRequestSchema.safeParse({ stepId,
    input: flags['input-file'] ? readJson(flags['input-file']) : { seed: readBounded(flags['seed-file']!), upstream: {} },
    ...(flags['system-prompt-file'] ? { systemPrompt: readBounded(flags['system-prompt-file']) } : {}),
    ...(flags['config-file'] ? { config: readJson(flags['config-file']) } : {}),
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
  const payload = JSON.stringify(parsed.data)
  if (Buffer.byteLength(payload) > FILE_BYTES) throw new CliError('Combined step experiment request exceeds 1 MiB', 'payload-too-large')
  const loader = new URL('../../server/node_modules/tsx/dist/loader.mjs', import.meta.url).href
  const worker = fileURLToPath(new URL('../../server/src/step-lab-main.ts', import.meta.url))
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', loader, worker], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    const finish = (error?: CliError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) { child.kill('SIGTERM'); reject(error) } else resolve(stdout)
    }
    const timer = setTimeout(() => finish(new CliError('Step timed out; the remote provider may still process the request', 'network-error')), timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > RESULT_BYTES) { finish(new CliError('Step response exceeds byte limit', 'invalid-response')); return }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-65536) })
    child.on('error', () => finish(new CliError('Unable to start the local server worker', 'step-worker-failed')))
    child.stdin.on('error', () => { /* close/error handlers report worker failures */ })
    child.on('close', code => {
      if (code !== 0 && stdout.trim() === '') {
        let errorCode = 'step-worker-failed'
        try {
          const last: unknown = JSON.parse(stderr.trim().split('\n').at(-1) ?? '')
          if (typeof last === 'object' && last !== null && 'code' in last && typeof last.code === 'string'
            && ['invalid-input', 'payload-too-large', 'llm-config-invalid'].includes(last.code)) errorCode = last.code
        } catch { /* never echo worker stderr or provider text */ }
        finish(new CliError('Local step worker failed; check input and model configuration', errorCode))
      } else finish()
    })
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
