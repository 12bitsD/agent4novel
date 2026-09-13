import { readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { artifactKinds, beatLimits, diagnosticQuerySchema } from '@agent4novel/contracts'
import type { ArtifactKind } from '@agent4novel/contracts'
import { CliError, createClient, parseCliTimeoutMs } from './client.js'
import * as cmd from './commands.js'
import { runLocalStep } from './local-step.js'

// agent4novel CLI(#14):Agent 从命令行驱动全链路。stdout 只出 JSON;进度/错误走 stderr。
// 用法:pnpm cli <command> [args] [--key value],server 地址 --url 或 A4N_BASE_URL(默认 http://localhost:8787)

const USAGE = `agent4novel cli — 命令:
  list                                  作品列表
  create --seed <text> | --seed-file <f> [--title <t>]
  get <workId> [--kind caption|creative|outline|setting|beat|prose] [--chapter 1]
  run-step <node> --input-file <f> | --seed-file <f> [--system-prompt-file <sp>] [--config-file <f>]
                                       独立运行 caption|creative|outline|setting|beat；本地 server worker，不写作品
                                       [--thinking on|off] [--temperature 0..1] [--top-p 0..1（不含 0）]
                                       参数覆盖 config-file 对应项；省略则沿用配置/模型运行时默认；不支持 --top-k
  advance <workId>                      推进流水线(同步长请求,默认等待 1820s)
  select <workId> [directionId]         选定创意方向(缺省取第一个)
  save-outline <workId> --file <f>      保存大纲草稿(f 为大纲 content JSON)
  approve <workId> <kind>               通过产物(如 outline)
  approve-setting <workId> --file <f>   编辑并通过设定(f 为完整 content + expectedHeadVersion 请求)
  approve-beat <workId> --file <f>      通过当前章纲(完整 content + chapter + expectedArtifactId + expectedHeadVersion)
  regenerate-beat <workId> --file <f>   整份再生(同上，另含 instructions；允许空草稿)
  config                               只读运行模式
  logs <workId> [--request-id <id>] [--attempt-id <id>]  命令/LLM 诊断与保留窗口
  smoke --seed <text> | --seed-file <f> [--title <t>]   一键全链路探针
全局: --url <baseUrl>                  默认 $A4N_BASE_URL 或 http://localhost:8787
      --timeout-ms <milliseconds>       覆盖所有请求；普通 300000；advance 1820000；Beat 通过 30000，再生 920000，恢复 GET 10000
run-step 不连接作品服务；不支持 --url；默认总等待 920000ms，支持 --timeout-ms。
输出: stdout 恒为 JSON;错误时 stderr 输出 {code,message,...} 且 exit 1。
advance 兼容 HTTP 200 的 kind:failed，必须检查 kind；smoke 遇 failed 必定非零退出。
pending 表示等待作者，allowedActions 不等于作者授权。Beat 通过后只读，本期不生成正文。`

type Args = { _: string[]; flags: Record<string, string> }

function parseArgs(argv: string[]): Args {
  const _: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!
    if (t === '--') continue // pnpm run 的参数分隔符
    if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      if (eq > 0) flags[t.slice(2, eq)] = t.slice(eq + 1)
      else flags[t.slice(2)] = argv[++i] ?? ''
    } else {
      _.push(t)
    }
  }
  return { _, flags }
}

function readSeed(flags: Record<string, string>): string {
  if (flags['seed-file']) return readFileSync(flags['seed-file'], 'utf8')
  if (flags.seed) return flags.seed
  throw new CliError('missing --seed or --seed-file', 'usage')
}

function requireKind(value: string | undefined): ArtifactKind {
  if (value && (artifactKinds as readonly string[]).includes(value)) return value as ArtifactKind
  throw new CliError(`invalid kind: ${value ?? '(missing)'}`, 'usage')
}

async function main(): Promise<void> {
  const { _, flags } = parseArgs(process.argv.slice(2))
  const [command, ...pos] = _
  const baseUrl = flags.url ?? process.env.A4N_BASE_URL ?? 'http://localhost:8787'
  const timeoutMs = parseCliTimeoutMs(flags['timeout-ms'] ?? process.env.A4N_CLI_TIMEOUT_MS)
  const client = createClient({ baseUrl, timeoutMs })
  const log = (line: string) => console.error(line)

  let result: unknown
  switch (command) {
    case 'run-step':
      if (pos.length !== 1) throw new CliError('run-step requires exactly one node', 'usage')
      result = await runLocalStep(pos[0], flags, timeoutMs)
      break
    case 'config':
      result = await client.getConfig()
      break
    case 'list':
      result = await cmd.list(client)
      break
    case 'create':
      result = await cmd.create(client, { seed: readSeed(flags), ...(flags.title ? { title: flags.title } : {}) })
      break
    case 'get':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      result = await cmd.get(client, pos[0], flags.kind ? requireKind(flags.kind) : undefined, flags.chapter === undefined ? undefined : Number(flags.chapter))
      break
    case 'advance':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      result = await cmd.advance(client, pos[0])
      break
    case 'select':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      result = await cmd.select(client, pos[0], pos[1])
      break
    case 'save-outline': {
      if (!pos[0] || !flags.file) throw new CliError('missing workId or --file', 'usage')
      const content = JSON.parse(readFileSync(flags.file, 'utf8')) as Parameters<typeof cmd.saveOutline>[2]
      result = await cmd.saveOutline(client, pos[0], content)
      break
    }
    case 'approve':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      result = await cmd.approve(client, pos[0], requireKind(pos[1]))
      break
    case 'approve-setting': {
      if (!pos[0] || !flags.file) throw new CliError('missing workId or --file', 'usage')
      let source: string
      try {
        source = readFileSync(flags.file, 'utf8')
      } catch {
        throw new CliError('Unable to read the setting request file', 'usage')
      }
      let input: unknown
      try {
        input = JSON.parse(source)
      } catch {
        throw new CliError('Setting request file must contain valid JSON', 'invalid-input')
      }
      result = await cmd.approveSetting(client, pos[0], input)
      break
    }
    case 'approve-beat':
    case 'regenerate-beat': {
      if (!pos[0] || !flags.file) throw new CliError('missing workId or --file', 'usage')
      if (Object.keys(flags).some(key => !['file', 'url', 'timeout-ms'].includes(key))) throw new CliError('Unknown Beat command option', 'usage')
      let source: string
      let descriptor: number | undefined
      try {
        descriptor = openSync(flags.file, 'r')
        const buffer = Buffer.alloc(beatLimits.bodyBytes + 1)
        let length = 0
        while (length < buffer.length) {
          const read = readSync(descriptor, buffer, length, buffer.length - length, null)
          if (read === 0) break
          length += read
        }
        if (length > beatLimits.bodyBytes) throw new CliError('Beat request file exceeds byte limit', 'payload-too-large')
        source = buffer.subarray(0, length).toString('utf8')
      } catch (error) {
        if (error instanceof CliError) throw error
        throw new CliError('Unable to read the Beat request file', 'usage')
      } finally { if (descriptor !== undefined) closeSync(descriptor) }
      let input: unknown
      try { input = JSON.parse(source) } catch { throw new CliError('Beat request file must contain valid JSON', 'invalid-input') }
      result = await cmd.runBeatCommand(client, pos[0], command, input)
      break
    }
    case 'logs':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      if (Object.keys(flags).some(key => !['request-id', 'attempt-id', 'url', 'timeout-ms'].includes(key))) throw new CliError('Unknown diagnostic option', 'usage')
      {
        const query = diagnosticQuerySchema.safeParse({ requestId: flags['request-id'], attemptId: flags['attempt-id'] })
        if (!query.success) throw new CliError('Invalid diagnostic filters', 'usage')
        result = await cmd.logs(client, pos[0], query.data)
      }
      break
    case 'smoke':
      result = await cmd.smoke(client, { seed: readSeed(flags), ...(flags.title ? { title: flags.title } : {}) }, log)
      break
    default:
      console.error(USAGE)
      process.exitCode = command ? 1 : 0
      return
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(JSON.stringify({ code: err.code, message: err.message, retryable: err.retryable, ...(err.attemptId ? { attemptId: err.attemptId } : {}), ...(err.issues ? { issues: err.issues } : {}), ...err.details }))
  } else {
    console.error(JSON.stringify({ code: 'internal', message: 'CLI command failed' }))
  }
  process.exitCode = 1
})
