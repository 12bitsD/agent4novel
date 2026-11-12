import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { NextloopError } from './nextloop-error.js'
import type { NextloopUsage } from './nextloop-error.js'

type Usage = NextloopUsage

export { NextloopError } from './nextloop-error.js'

export type NextloopModel = {
  modelId: string
  baseUrl: string
  apiKeyEnv: 'DEEPSEEK_API_KEY' | 'LONGCAT_API_KEY' | 'KIMI_API_KEY' | 'MOONSHOT_API_KEY'
}

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
})
const responseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('succeeded'), content: z.unknown(), finishReason: z.string().nullable(), usage: usageSchema }),
  z.object({
    kind: z.literal('failed'),
    code: z.enum(['llm-timeout', 'llm-invalid-output', 'llm-unavailable', 'invalid-input']),
    retryable: z.boolean(),
    finishReason: z.string().nullable().optional(),
    usage: usageSchema.optional(),
  }),
])

function pythonExecutable(): string {
  const configured = process.env.A4N_NEXTLOOP_PYTHON?.trim()
  if (configured) return configured
  const candidates = [
    resolve(process.cwd(), '.venv/bin/python'),
    resolve(process.cwd(), '../../.venv/bin/python'),
    fileURLToPath(new URL('../../../.venv/bin/python', import.meta.url)),
    fileURLToPath(new URL('../../../../.venv/bin/python', import.meta.url)),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!
}

function usage(value: z.infer<typeof usageSchema> | undefined): Usage | undefined {
  if (!value) return undefined
  return {
    ...(value.inputTokens === null ? {} : { inputTokens: value.inputTokens }),
    ...(value.outputTokens === null ? {} : { outputTokens: value.outputTokens }),
  }
}

export async function runNextloop<T>(args: {
  schema: z.ZodType<T>
  model: NextloopModel
  system: string
  prompt: string
  attemptId: string
  timeoutMs: number
  maxOutputTokens: number
  maxRetries?: number
  temperature?: number
  topP?: number
  providerOptions?: { longcat: { thinking: { type: 'enabled' | 'disabled' } } }
}): Promise<{ object: T; usage: Usage; finishReason: string }> {
  const maxProviderAttempts = args.maxRetries === undefined ? 3 : args.maxRetries + 1
  if (!Number.isSafeInteger(maxProviderAttempts) || maxProviderAttempts < 1) {
    throw new NextloopError('llm-unavailable', false)
  }
  const payload = JSON.stringify({
    version: 1,
    attemptId: args.attemptId,
    system: args.system,
    prompt: args.prompt,
    provider: args.model,
    parameters: {
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.topP !== undefined ? { top_p: args.topP } : {}),
      ...(args.providerOptions ? { thinking: args.providerOptions.longcat.thinking } : {}),
    },
    maxOutputTokens: args.maxOutputTokens,
    maxProviderAttempts,
    timeoutMs: args.timeoutMs,
  })
  if (Buffer.byteLength(payload) > 1024 * 1024) throw new NextloopError('llm-unavailable', false)
  const child = spawn(pythonExecutable(), ['-m', 'agent4novel_nextloop.worker'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const killChild = () => { child.kill('SIGTERM') }
  const cleanup = () => {
    process.removeListener('exit', killChild)
    process.removeListener('SIGTERM', onSigterm)
    process.removeListener('SIGINT', onSigint)
  }
  const forwardSignal = (signal: 'SIGTERM' | 'SIGINT') => {
    process.removeListener(signal, signal === 'SIGTERM' ? onSigterm : onSigint)
    killChild()
    process.kill(process.pid, signal)
  }
  const onSigterm = () => forwardSignal('SIGTERM')
  const onSigint = () => forwardSignal('SIGINT')
  process.once('exit', killChild)
  process.once('SIGTERM', onSigterm)
  process.once('SIGINT', onSigint)
  const execution = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    const fail = (error: NextloopError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      child.kill('SIGTERM')
      reject(error)
    }
    const timer = setTimeout(() => fail(new NextloopError('llm-timeout', true)), args.timeoutMs + 1000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > 8 * 1024 * 1024) {
        fail(new NextloopError('llm-invalid-output', true))
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-65536) })
    child.on('error', () => fail(new NextloopError('llm-unavailable', false)))
    child.stdin.on('error', () => {})
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      resolve({ stdout, code })
    })
    child.stdin.end(payload)
  })
  let json: unknown
  try { json = JSON.parse(execution.stdout) } catch { throw new NextloopError('llm-unavailable', true) }
  const response = responseSchema.safeParse(json)
  if (!response.success) throw new NextloopError('llm-unavailable', true)
  if (response.data.kind === 'failed') {
    const code = response.data.code === 'invalid-input' ? 'llm-unavailable' : response.data.code
    throw new NextloopError(code, response.data.retryable, usage(response.data.usage), response.data.finishReason ?? undefined)
  }
  if (execution.code !== 0) throw new NextloopError('llm-unavailable', true)
  return {
    object: args.schema.parse(response.data.content),
    usage: usage(response.data.usage) ?? {},
    finishReason: response.data.finishReason ?? 'unknown',
  }
}

export async function assertNextloopReady(): Promise<void> {
  const child = spawn(pythonExecutable(), ['-c',
    'import importlib.metadata,sys; assert sys.version_info >= (3,11); assert importlib.metadata.version("nextloop") == "1.0.0"',
  ], { env: process.env, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new NextloopError('llm-unavailable', false))
    }, 5000)
    child.once('error', () => {
      clearTimeout(timer)
      reject(new NextloopError('llm-unavailable', false))
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new NextloopError('llm-unavailable', false))
    })
  })
}
