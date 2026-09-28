import { readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { artifactKinds, beatLimits, proseLimits, diagnosticQuerySchema } from '@agent4novel/contracts'
import type { ArtifactKind } from '@agent4novel/contracts'
import { CliError, createClient, parseCliTimeoutMs } from './client.js'
import * as cmd from './commands.js'
import { runLocalStep } from './local-step.js'
import { helpFor, parseCommandLine } from './command-line.js'

// agent4novel CLI(#14):Agent 从命令行驱动全链路。stdout 只出 JSON;进度/错误走 stderr。
// 用法:pnpm cli <command> [args] [--key value],server 地址 --url 或 A4N_BASE_URL(默认 http://localhost:8787)

function readSeed(flags: Record<string, string>): string {
  if (flags['seed-file']) return readFileSync(flags['seed-file'], 'utf8')
  if (flags.seed) return flags.seed
  throw new CliError('missing --seed or --seed-file', 'usage')
}

function requireKind(value: string | undefined): ArtifactKind {
  if (value && (artifactKinds as readonly string[]).includes(value)) return value as ArtifactKind
  throw new CliError('Invalid artifact kind; use --help', 'usage')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  // Help is discovery, even when mixed with incomplete or invalid invocation data.
  if (argv.every(token => token === '--') || argv.includes('--help') || argv.includes('-h')) {
    console.error(helpFor(argv))
    return
  }
  const { _, flags } = parseCommandLine(argv)
  const [command, ...pos] = _
  const baseUrl = flags.url ?? process.env.A4N_BASE_URL ?? 'http://localhost:8787'
  const timeoutMs = parseCliTimeoutMs(flags['timeout-ms'] ?? process.env.A4N_CLI_TIMEOUT_MS)
  const client = createClient({ baseUrl, timeoutMs })
  const log = (line: string) => console.error(line)

  let result: unknown
  switch (command) {
    case 'run-step':
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
      result = await cmd.get(client, pos[0], flags.kind ? requireKind(flags.kind) : undefined, flags.chapter === undefined ? undefined : Number(flags.chapter))
      break
    case 'advance':
      result = await cmd.advance(client, pos[0])
      break
    case 'select':
      result = await cmd.select(client, pos[0], pos[1])
      break
    case 'save-outline': {
      const content = JSON.parse(readFileSync(flags.file, 'utf8')) as Parameters<typeof cmd.saveOutline>[2]
      result = await cmd.saveOutline(client, pos[0], content)
      break
    }
    case 'approve':
      result = await cmd.approve(client, pos[0], requireKind(pos[1]))
      break
    case 'approve-setting': {
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
    case 'start-chapter':
    case 'approve-beat':
    case 'regenerate-beat':
    case 'approve-prose':
    case 'save-prose':
    case 'regenerate-prose': {
      const isProse = command === 'approve-prose' || command === 'regenerate-prose' || command === 'save-prose'
      const limit = isProse ? proseLimits.bodyBytes : beatLimits.bodyBytes
      const label = command === 'start-chapter' ? 'Chapter' : isProse ? 'Prose' : 'Beat'
      let source: string
      let descriptor: number | undefined
      try {
        descriptor = openSync(flags.file, 'r')
        const buffer = Buffer.alloc(limit + 1)
        let length = 0
        while (length < buffer.length) {
          const read = readSync(descriptor, buffer, length, buffer.length - length, null)
          if (read === 0) break
          length += read
        }
        if (length > limit) throw new CliError(`${label} request file exceeds byte limit`, 'payload-too-large')
        try {
          source = isProse || command === 'start-chapter' ? new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) : buffer.subarray(0, length).toString('utf8')
        } catch { throw new CliError(`${label} request file must contain valid UTF-8`, 'invalid-input') }
      } catch (error) {
        if (error instanceof CliError) throw error
        throw new CliError(`${label} request file could not be read`, 'usage')
      } finally { if (descriptor !== undefined) closeSync(descriptor) }
      let input: unknown
      try { input = JSON.parse(source) } catch { throw new CliError(`${label} request file must contain valid JSON`, 'invalid-input') }
      result = command === 'start-chapter' ? await cmd.startChapter(client, pos[0], input)
        : isProse ? await cmd.runProseCommand(client, pos[0], command, input) : await cmd.runBeatCommand(client, pos[0], command, input)
      break
    }
    case 'logs':
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
      throw new CliError('Unknown command; use --help', 'usage')
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
