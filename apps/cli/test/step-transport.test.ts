import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../bin/a4n', import.meta.url))
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)
const caption = { inputStage: '主线', summary: '合成故事的开发价值', elements: [], gaps: [] }

async function invoke(args: string[], providerUrl: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(bin, args, { env: { ...process.env, A4N_MODEL: 'longcat:LongCat-2.0',
    LONGCAT_API_KEY: 'synthetic-step-key', LONGCAT_BASE_URL: providerUrl, DEEPSEEK_API_KEY: '',
    A4N_LLM_TIMEOUT_MS: '5000', A4N_CLI_TIMEOUT_MS: '10000', ...env,
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

describe('run-step through a local mock provider', () => {
  it('uses the configured request model even when the startup default has no credential', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-model-'))
    const requests: { model: string }[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      requests.push(JSON.parse(source))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-model-override', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify(caption) }, finish_reason: 'stop' }] }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'synthetic model override seed')
      const configFile = join(directory, 'config.json'); writeFileSync(configFile, JSON.stringify({ model: 'longcat:LongCat-2.0' }))
      const args = ['run-step', 'caption', '--seed-file', seedFile, '--config-file', configFile]
      const providerUrl = `http://127.0.0.1:${address.port}/v1`
      const result = await invoke(args, providerUrl, { A4N_MODEL: 'deepseek:deepseek-chat' })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'succeeded', model: 'longcat:LongCat-2.0', content: caption })
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ model: 'LongCat-2.0' })
      writeFileSync(configFile, JSON.stringify({ model: 'deepseek:deepseek-chat' }))
      const unavailable = await invoke(args, providerUrl)
      expect(unavailable.code).toBe(1)
      expect(unavailable.stdout).toBe('')
      expect(JSON.parse(unavailable.stderr)).toMatchObject({ code: 'llm-config-invalid' })
      expect(requests).toHaveLength(1)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('sends explicit thinking and sampling controls from the executable to the provider', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-controls-'))
    const requests: unknown[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      requests.push(JSON.parse(source))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-caption', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify(caption) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'synthetic generation controls seed')
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile,
        '--thinking', 'off', '--temperature', '0.9', '--top-p', '0.95'], `http://127.0.0.1:${address.port}/v1`)
      expect(result.code).toBe(0)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0.9, top_p: 0.95 })
      expect(JSON.parse(result.stdout).telemetry[0].generation).toEqual({ thinking: 'disabled', temperature: 0.9, topP: 0.95 })
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('uses config-file controls and lets flags override only the supplied fields', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-config-controls-'))
    const requests: unknown[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      requests.push(JSON.parse(source))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-caption', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify(caption) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'synthetic config controls seed')
      const configFile = join(directory, 'config.json')
      const args = ['run-step', 'caption', '--seed-file', seedFile, '--config-file', configFile]
      const providerUrl = `http://127.0.0.1:${address.port}/v1`
      writeFileSync(configFile, JSON.stringify({ thinking: 'enabled', temperature: 0.4, topP: 0.6 }))
      expect((await invoke(args, providerUrl)).code).toBe(0)
      expect((await invoke([...args, '--thinking', 'off', '--temperature', '0.9'], providerUrl)).code).toBe(0)
      writeFileSync(configFile, JSON.stringify({ thinking: 'disabled', temperature: 0, topP: 1 }))
      expect((await invoke([...args, '--thinking', 'on'], providerUrl)).code).toBe(0)
      expect(requests).toHaveLength(3)
      expect(requests[0]).toMatchObject({ thinking: { type: 'enabled' }, temperature: 0.4, top_p: 0.6 })
      expect(requests[1]).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0.9, top_p: 0.6 })
      expect(requests[2]).toMatchObject({ thinking: { type: 'enabled' }, temperature: 0, top_p: 1 })
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('rejects malformed or unsupported controls before contacting the provider, even when flags would replace invalid config', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-invalid-controls-'))
    let calls = 0
    const server = createServer((_req, res) => { calls++; res.writeHead(401); res.end() })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'private-controls-seed-sentinel')
      const configFile = join(directory, 'config.json')
      const args = ['run-step', 'caption', '--seed-file', seedFile]
      const providerUrl = `http://127.0.0.1:${address.port}/v1`
      const invalidFlags = [
        ['--thinking', 'disabled'], ['--thinking', 'ON'], ['--thinking', ''],
        ['--temperature', ''], ['--temperature', ' '], ['--temperature', 'NaN'], ['--temperature', 'Infinity'],
        ['--temperature', '-0.1'], ['--temperature', '1.1'],
        ['--top-p', ''], ['--top-p', 'NaN'], ['--top-p', 'Infinity'], ['--top-p', '0'], ['--top-p', '-1'], ['--top-p', '1.1'],
        ['--top-k', '40'],
      ]
      for (const flags of invalidFlags) {
        const result = await invoke([...args, ...flags], providerUrl)
        expect(result.code, JSON.stringify(flags)).toBe(1)
        expect(result.stdout).toBe('')
        expect(['usage', 'invalid-input']).toContain(JSON.parse(result.stderr).code)
        if (flags[0] === '--top-k') expect(JSON.parse(result.stderr).message).toContain('--top-k is not supported')
        expect(result.stderr).not.toContain('private-controls-seed-sentinel')
      }
      for (const config of [
        { thinking: 'on' }, { temperature: 1.1 }, { temperature: '0.4' }, { topP: 0 }, { topK: 40 }, { unknown: true },
      ]) {
        writeFileSync(configFile, JSON.stringify(config))
        const result = await invoke([...args, '--config-file', configFile, '--thinking', 'off', '--temperature', '0.9', '--top-p', '0.95'], providerUrl)
        expect(result.code, JSON.stringify(config)).toBe(1)
        expect(result.stdout).toBe('')
        expect(JSON.parse(result.stderr).code).toBe('invalid-input')
      }
      expect(calls).toBe(0)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('runs two SP files with identical user input and returns schema-valid content and distinct system hashes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-transport-'))
    const requests: { model: string; messages: { role: string; content: string }[]; max_tokens: number }[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      requests.push(JSON.parse(source))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-caption', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify(caption) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); const spFile = join(directory, 'sp.md')
      writeFileSync(seedFile, '合成素材')
      const results = []
      for (const system of ['V1 合成提炼指令', 'V2 合成开发指令']) {
        writeFileSync(spFile, system)
        const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--system-prompt-file', spFile], `http://127.0.0.1:${address.port}/v1`)
        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        const output = JSON.parse(result.stdout)
        expect(output).toMatchObject({ kind: 'succeeded', stepId: 'caption', executionMode: 'live', content: caption })
        expect(output.telemetry).toHaveLength(1)
        expect(output.telemetry[0]).toMatchObject({ systemHash: hash(system), promptHash: hash('作者原始素材:\n合成素材\n\n请输出提炼稿。'), ok: true })
        expect(output.telemetry[0].generation).toEqual({ thinking: 'disabled', temperature: 0.9, topP: 0.95 })
        expect(result.stdout).not.toContain('synthetic-step-key')
        results.push(output)
      }
      expect(requests).toHaveLength(2)
      expect(requests[0]!.messages.find(m => m.role === 'user')).toEqual(requests[1]!.messages.find(m => m.role === 'user'))
      expect(requests.map(r => r.max_tokens)).toEqual([8000, 8000])
      for (const request of requests) {
        expect(request).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0.9, top_p: 0.95 })
        expect(request).not.toHaveProperty('top_k')
      }
      expect(requests[0]!.messages.find(m => m.role === 'system')?.content).toContain('V1 合成提炼指令')
      expect(requests[1]!.messages.find(m => m.role === 'system')?.content).toContain('V2 合成开发指令')
      expect(results[0].runId).not.toBe(results[1].runId)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('ends the worker on a CLI deadline and returns one safe JSON error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-timeout-'))
    let calls = 0
    let disconnected = false
    const server = createServer((req, _res) => {
      calls++
      req.socket.on('close', () => { disconnected = true })
      req.resume()
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'synthetic timeout seed')
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--timeout-ms', '2000'], `http://127.0.0.1:${address.port}/v1`)
      expect(result.code).toBe(1); expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({ code: 'network-error', retryable: false })
      expect(calls).toBe(1)
      expect(disconnected).toBe(true)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 15000)

  it('returns nonzero with safe telemetry on provider rejection and never retries a 401', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-error-'))
    let calls = 0
    const server = createServer((_req, res) => {
      calls++; res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'private-provider-sentinel', type: 'authentication_error' } }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'private-seed-sentinel')
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile], `http://127.0.0.1:${address.port}/v1`)
      expect(result.code).toBe(1); expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({ kind: 'failed', code: 'llm-unavailable', stepId: 'caption', telemetry: [{ ok: false }] })
      expect(result.stderr).not.toContain('private-provider-sentinel')
      expect(result.stderr).not.toContain('private-seed-sentinel')
      expect(result.stderr).not.toContain('synthetic-step-key')
      expect(calls).toBe(1)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)
})
