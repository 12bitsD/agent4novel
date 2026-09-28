import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliBin, cliTestEnv } from './cli-process.js'

describe('CLI command discovery and syntax', () => {
  let server: ReturnType<typeof createServer>
  let baseUrl: string
  let requests: { method: string; url: string; body: string }[]
  let response: unknown

  beforeEach(async () => {
    requests = []
    response = { kind: 'complete', state: { workId: 'work-synthetic', stage: 'complete', nextStepId: null }, telemetry: [] }
    server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push({ method: req.method!, url: req.url!, body })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(response))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  async function invoke(args: string[], env: NodeJS.ProcessEnv = {}) {
    const child = spawn(cliBin, args, { env: cliTestEnv({ A4N_BASE_URL: baseUrl, ...env }), stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 })
    let stdout = ''; let stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const [code] = await once(child, 'close')
    return { code, stdout, stderr }
  }

  it('shows advance help without executing the supplied work command', async () => {
    const result = await invoke(['advance', 'work-synthetic', '--help'])
    expect(requests).toEqual([])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('advance <workId>')
  })

  it.each([[], ['--'], ['--help'], ['-h'], ['private-unknown-command', '--help']])
    ('shows global help with invalid configuration: %j', async (...args) => {
      const result = await invoke(args, { A4N_CLI_TIMEOUT_MS: 'invalid-timeout', A4N_MODEL: 'invalid-provider' })
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('agent4novel cli')
      expect(result.stderr).not.toContain('private-')
      expect(requests).toEqual([])
    })

  it.each([
    ['--help', 'advance', 'work-synthetic'],
    ['--url', 'get', '--timeout-ms', '5', 'advance', 'work-synthetic', '-h'],
    ['advance', 'work-synthetic', '--url', '--help', '--timeout-ms', 'invalid-timeout'],
  ])('finds the help command without treating option values as commands: %j', async (...args) => {
    const result = await invoke(args)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('用法: a4n advance')
    expect(result.stderr).not.toContain('用法: a4n get')
    expect(requests).toEqual([])
  })

  it.each(['list', 'create', 'get', 'run-step', 'advance', 'select', 'save-outline', 'approve', 'approve-setting', 'approve-beat', 'regenerate-beat', 'approve-prose', 'regenerate-prose', 'save-prose', 'config', 'logs', 'smoke'])
    ('offers scoped %s help before invalid configuration, arguments or files', async command => {
      for (const help of ['--help', '-h']) {
        const result = await invoke([command, help, '--file', '/missing/private-file', '--unknown'], {
          A4N_CLI_TIMEOUT_MS: 'invalid-timeout', A4N_MODEL: 'invalid-provider',
        })
        expect(result.code).toBe(0)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain(`用法: a4n ${command}`)
        expect(result.stderr).toContain('示例:')
        expect(result.stderr).toContain('副作用:')
        expect(result.stderr).not.toContain('private-file')
      }
      expect(requests).toEqual([])
    })

  it('rejects malformed save files without HTTP and never leaks or rewrites their contents', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'a4n-prose-file-'))
    const file = join(folder, 'private-request.json')
    const request = { chapter: 1, expectedArtifactId: 'prose-1', expectedHeadVersion: 1, expectedHumanStatus: 'pending', content: { text: 'private-text' } }
    const cases = [
      { bytes: Buffer.from('private-broken-json'), code: 'invalid-input' },
      { bytes: Buffer.from(JSON.stringify({ ...request, expectedHumanStatus: undefined })), code: 'invalid-input' },
      { bytes: Buffer.from(JSON.stringify({ ...request, content: { text: 'private-text', extra: 'private-extra' } })), code: 'invalid-input' },
      { bytes: Buffer.from(JSON.stringify({ ...request, chapter: 2 })), code: 'invalid-input' },
      { bytes: Buffer.concat([Buffer.from(JSON.stringify(request).replace('private-text', '')), Buffer.alloc(1024 * 1024, 32)]), code: 'payload-too-large' },
      { bytes: Buffer.concat([Buffer.from(JSON.stringify(request).split('private-text')[0]!), Buffer.from([0xc3, 0x28]), Buffer.from(JSON.stringify(request).split('private-text')[1]!)]), code: 'invalid-input' },
    ]
    try {
      for (const candidate of cases) {
        writeFileSync(file, candidate.bytes)
        const result = await invoke(['save-prose', 'work-synthetic', '--file', file])
        expect(result.code).toBe(1)
        expect(result.stdout).toBe('')
        expect(JSON.parse(result.stderr)).toMatchObject({ code: candidate.code })
        expect(result.stderr).not.toMatch(/private-request|private-text|private-extra|private-broken-json/)
        expect(requests).toEqual([])
        expect(readFileSync(file)).toEqual(candidate.bytes)
      }
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })

  it.each([
    ['advance', 'work-synthetic', '--thinking', 'private-option-value'],
    ['get', 'work-synthetic', '--knd', 'private-option-value'],
    ['private-unknown-command'],
    ['advance', '-x'],
    ['advance', 'work-synthetic', '--url', 'private-option-value', '--url', 'private-other-value'],
    ['advance', 'work-synthetic', '--url'],
    ['advance', 'work-synthetic', '--url', '--timeout-ms', '1000'],
    ['advance', 'work-synthetic', '--url='],
    ['advance', 'work-synthetic', '--url', '   '],
    ['get', 'work-synthetic', '--kind', 'private-invalid-kind'],
    ['approve', 'work-synthetic', 'private-invalid-kind'],
    ['advance', 'work-synthetic', '--private-option-name', 'private-option-value'],
  ])('rejects invalid syntax before any HTTP request: %j', async (...args) => {
    const result = await invoke(args)
    expect(requests).toEqual([])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
    expect(result.stderr).not.toContain('private-')
  })

  it.each([
    ['list', 'private-extra'],
    ['config', 'private-extra'],
    ['create', '--seed', 'synthetic', 'private-extra'],
    ['smoke', '--seed', 'synthetic', 'private-extra'],
    ['get', 'work-synthetic', 'private-extra'],
    ['advance', 'work-synthetic', 'private-extra'],
    ['select', 'work-synthetic', 'direction-synthetic', 'private-extra'],
    ['approve', 'work-synthetic', 'outline', 'private-extra'],
    ['save-outline', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['approve-setting', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['approve-beat', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['regenerate-beat', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['logs', 'work-synthetic', 'private-extra'],
    ['run-step', 'caption', '--seed-file', '/missing/private-file', 'private-extra'],
    ['get'], ['advance'], ['select'], ['approve', 'work-synthetic'],
    ['save-outline', '--file', '/missing/private-file'],
    ['approve-setting', '--file', '/missing/private-file'],
    ['approve-beat', '--file', '/missing/private-file'],
    ['regenerate-beat', '--file', '/missing/private-file'],
    ['logs'], ['run-step', '--seed-file', '/missing/private-file'],
    ['advance', '   '], ['select', 'work-synthetic', ''],
  ])('rejects missing, extra or blank positionals before execution: %j', async (...args) => {
    const result = await invoke(args)
    expect(requests).toEqual([])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
    expect(result.stderr).not.toContain('private-')
  })

  it.each([
    ['create'], ['smoke'], ['run-step', 'caption'],
    ['create', '--seed', 'private-seed', '--seed-file', '/missing/private-file'],
    ['smoke', '--seed', 'private-seed', '--seed-file', '/missing/private-file'],
    ['run-step', 'caption', '--input-file', '/missing/private-input', '--seed-file', '/missing/private-file'],
    ['save-outline', 'work-synthetic'], ['approve-setting', 'work-synthetic'],
    ['approve-beat', 'work-synthetic'], ['regenerate-beat', 'work-synthetic'],
  ])('rejects missing or mutually exclusive inputs before execution: %j', async (...args) => {
    const result = await invoke(args)
    expect(requests).toEqual([])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
    expect(result.stderr).not.toContain('private-')
  })

  it('preserves leading global options, equals values, pnpm separators and literal help values', async () => {
    response = { id: 'work-synthetic', title: 'Synthetic work', seed: '--help' }
    const result = await invoke(['--', '--url', baseUrl, '--timeout-ms=1000', 'create', '--', '--seed=--help', '--title=Synthetic work'], {
      A4N_BASE_URL: 'http://127.0.0.1:1',
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual(response)
    expect(requests).toEqual([{ method: 'POST', url: '/api/works', body: JSON.stringify({ seed: '--help', title: 'Synthetic work' }) }])
  })

  it('preserves the successful process exit for an advance business failure', async () => {
    response = { kind: 'failed', stepId: 'outline', code: 'llm-output-invalid', retryable: false,
      state: { workId: 'work-synthetic', stage: 'ready', nextStepId: 'outline' }, telemetry: [] }
    const result = await invoke(['advance', 'work-synthetic'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual(response)
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([{ method: 'POST', url: '/api/works/work-synthetic/advance' }])
  })

  it('does not call a configured provider when run-step help has valid input', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-help-provider-'))
    try {
      const seedFile = join(directory, 'seed.txt')
      writeFileSync(seedFile, 'synthetic help seed')
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--help'], {
        A4N_MODEL: 'longcat:LongCat-2.0', LONGCAT_API_KEY: 'synthetic-key', LONGCAT_BASE_URL: `${baseUrl}/v1`,
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('用法: a4n run-step')
      expect(requests).toEqual([])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform === 'win32')('returns help and usage without opening input files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-help-file-'))
    try {
      // A FIFO with no writer blocks at open: a completed command proves the file was not read.
      const file = join(directory, 'unread-input')
      expect(spawnSync('mkfifo', [file]).status).toBe(0)
      for (const args of [
        ['create', '--seed-file', file], ['smoke', '--seed-file', file],
        ['run-step', 'caption', '--seed-file', file],
        ['save-outline', 'work-synthetic', '--file', file],
        ['approve-setting', 'work-synthetic', '--file', file],
        ['approve-beat', 'work-synthetic', '--file', file],
        ['regenerate-beat', 'work-synthetic', '--file', file],
      ]) {
        const help = await invoke([...args, '--help'])
        expect(help.code).toBe(0)
        const invalid = await invoke([...args, 'extra-positional'])
        expect(invalid.code).toBe(1)
        expect(JSON.parse(invalid.stderr)).toMatchObject({ code: 'usage' })
      }
      expect(requests).toEqual([])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 20000)
})
