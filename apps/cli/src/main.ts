import { readFileSync } from 'node:fs'
import { artifactKinds } from '@agent4novel/contracts'
import type { ArtifactKind } from '@agent4novel/contracts'
import { CliError, createClient, parseCliTimeoutMs } from './client.js'
import * as cmd from './commands.js'

// agent4novel CLI(#14):Agent 从命令行驱动全链路。stdout 只出 JSON;进度/错误走 stderr。
// 用法:pnpm cli <command> [args] [--key value],server 地址 --url 或 A4N_BASE_URL(默认 http://localhost:8787)

const USAGE = `agent4novel cli — 命令:
  list                                  作品列表
  create --seed <text> | --seed-file <f> [--title <t>]
  get <workId> [--kind caption|creative|outline|setting]
  advance <workId>                      推进流水线(同步长请求,默认等待 1820s)
  select <workId> [directionId]         选定创意方向(缺省取第一个)
  save-outline <workId> --file <f>      保存大纲草稿(f 为大纲 content JSON)
  approve <workId> <kind>               通过产物(如 outline)
  approve-setting <workId> --file <f>   编辑并通过设定(f 为完整 content + expectedHeadVersion 请求)
  logs <workId>                         LLM 遥测回看(latency/tokens/finishReason/hash)
  smoke --seed <text> | --seed-file <f> [--title <t>]   一键全链路探针
全局: --url <baseUrl>                  默认 $A4N_BASE_URL 或 http://localhost:8787
      --timeout-ms <milliseconds>       覆盖所有请求；普通请求默认 300000，advance 默认 1820000
输出: stdout 恒为 JSON;错误时 stderr 输出 {code,message} 且 exit 1`

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
    case 'list':
      result = await cmd.list(client)
      break
    case 'create':
      result = await cmd.create(client, { seed: readSeed(flags), ...(flags.title ? { title: flags.title } : {}) })
      break
    case 'get':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      result = await cmd.get(client, pos[0], flags.kind ? requireKind(flags.kind) : undefined)
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
    case 'logs':
      if (!pos[0]) throw new CliError('missing workId', 'usage')
      result = await cmd.logs(client, pos[0])
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
    console.error(JSON.stringify({ code: err.code, message: err.message, retryable: err.retryable, ...(err.attemptId ? { attemptId: err.attemptId } : {}), ...(err.issues ? { issues: err.issues } : {}) }))
  } else {
    console.error(JSON.stringify({ code: 'internal', message: err instanceof Error ? err.message : String(err) }))
  }
  process.exitCode = 1
})
