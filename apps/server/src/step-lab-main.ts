// 独立 server 进程入口。stdin 接收实验请求，stdout 只返回单个 JSON 结果。
import { stepExperimentRequestSchema } from '@agent4novel/contracts'
import { loadLocalEnv } from './config/local-env.js'

async function main() {
  const parts: Buffer[] = []
  let length = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.length
    if (length > 1024 * 1024) {
      console.error(JSON.stringify({ code: 'payload-too-large' }))
      process.exitCode = 1
      return
    }
    parts.push(bytes)
  }
  let raw: unknown
  try { raw = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch {
    console.error(JSON.stringify({ code: 'invalid-input' })); process.exitCode = 1; return
  }
  const parsed = stepExperimentRequestSchema.safeParse(raw)
  if (!parsed.success) {
    console.error(JSON.stringify({ code: 'invalid-input' })); process.exitCode = 1; return
  }
  loadLocalEnv()
  // This worker serves one request: validate its selected model at runtime startup.
  // The normal server still rejects an unconfigured A4N_MODEL.
  if (parsed.data.config?.model !== undefined) process.env.A4N_MODEL = parsed.data.config.model
  // Production safeLog 使用 console.log；仅本 worker 将诊断导向 stderr。
  console.log = (...args: unknown[]) => console.error(...args)
  const { runIsolatedStep } = await import('./steps/isolated-runner.js')
  const result = await runIsolatedStep(parsed.data)
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.kind === 'failed') process.exitCode = 1
}
main().catch(() => {
  console.error(JSON.stringify({ code: 'llm-config-invalid' }))
  process.exitCode = 1
})
