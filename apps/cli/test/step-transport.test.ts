import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliBin as bin, cliTestEnv } from './cli-process.js'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)
const caption = { inputStage: '主线', summary: '合成故事的开发价值', elements: [], gaps: [] }

async function invoke(args: string[], providerUrl: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(bin, args, { env: cliTestEnv({ A4N_MODEL: 'longcat:LongCat-2.0',
    LONGCAT_API_KEY: 'synthetic-step-key', LONGCAT_BASE_URL: providerUrl, DEEPSEEK_API_KEY: '',
    A4N_LLM_TIMEOUT_MS: '5000', A4N_CLI_TIMEOUT_MS: '10000', ...env,
  }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

describe('run-step through a local mock provider', () => {
  it('writes a private complete record with the actual transport input and final result', async () => {
    const directory = mkdtempSync(join(realpathSync(tmpdir()), 'a4n-step-record-cli-'))
    const recordDir = join(directory, 'run-a')
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-record', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify(caption) }, finish_reason: 'stop' }] }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'recorded cli seed')
      const spFile = join(directory, 'sp.md'); writeFileSync(spFile, 'recorded cli system')
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--system-prompt-file', spFile, '--record-dir', recordDir,
        '--thinking', 'off', '--temperature', '0.4', '--top-p', '0.6'], `http://127.0.0.1:${address.port}/v1`)
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'succeeded', recording: { status: 'complete', dir: recordDir } })
      expect(readdirSync(recordDir).sort()).toEqual(['input.json', 'invocation.json', 'meta.json', 'result.json'])
      const invocation = JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8'))
      const recordedResult = JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8'))
      expect(invocation).toMatchObject({ captured: true, system: 'recorded cli system', prompt: '作者原始素材:\nrecorded cli seed\n\n请输出提炼稿。',
        generation: { thinking: 'disabled', temperature: 0.4, topP: 0.6 }, maxOutputTokens: 8000 })
      expect(recordedResult).toMatchObject({ status: 'succeeded', content: caption })
      expect(statSync(recordDir).mode & 0o777).toBe(0o700)
      for (const file of ['input.json', 'invocation.json', 'meta.json', 'result.json']) expect(statSync(join(recordDir, file)).mode & 0o777).toBe(0o600)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('supports one complete prose A/B/comment loop through the CLI worker and files', async () => {
    const directory = mkdtempSync(join(realpathSync(tmpdir()), 'a4n-step-iteration-loop-'))
    const requests: { messages: { role: string; content: string }[] }[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      const request = JSON.parse(source) as { messages: { role: string; content: string }[] }
      requests.push(request)
      const system = request.messages.find(message => message.role === 'system')?.content ?? ''
      const text = system.includes('B版') ? 'B版正文：第二段更具体。' : 'A版正文：第二段仍需调整。'
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-iteration-loop', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify({ text }) }, finish_reason: 'stop' }] }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    const input = { seed: '合成正文迭代素材', chapter: 1, upstream: {
      beat: { title: '过桥', goal: '继续追寻', writingPlan: [{ itemId: 'item-one', title: '行动', content: '沿桥寻找线索' }], ending: '发现新线索' },
      setting: { overview: '城市夜行', world: [{ itemId: 'world-one', title: '城市', content: '河流横贯城市' }],
        characters: [{ itemId: 'char-one', title: '主角', content: '寻找证人' }], factions: [], relationships: [], extensions: [] },
    } }
    try {
      const inputFile = join(directory, 'prose-input.json'); const spFile = join(directory, 'sp.md')
      writeFileSync(inputFile, JSON.stringify(input))
      const providerUrl = `http://127.0.0.1:${address.port}/v1`
      const run = async (recordDir: string, system: string) => {
        writeFileSync(spFile, system)
        return invoke(['run-step', 'prose', '--input-file', inputFile, '--system-prompt-file', spFile, '--record-dir', recordDir], providerUrl)
      }
      const aDir = join(directory, 'A'); const bDir = join(directory, 'B')
      const a = await run(aDir, 'A版迭代：定位第二段。')
      const b = await run(bDir, 'B版迭代：第二段更具体。')
      expect(a.code, a.stderr).toBe(0); expect(b.code, b.stderr).toBe(0)
      const readRecord = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, any>
      const aInput = readRecord(aDir, 'input.json'); const aInvocation = readRecord(aDir, 'invocation.json'); const aResult = readRecord(aDir, 'result.json'); const aMeta = readRecord(aDir, 'meta.json')
      const bInput = readRecord(bDir, 'input.json'); const bInvocation = readRecord(bDir, 'invocation.json'); const bResult = readRecord(bDir, 'result.json'); const bMeta = readRecord(bDir, 'meta.json')
      writeFileSync(join(directory, 'comments.md'), '用户原话：第二段还在讲道理。\nAgent观察：A版问题集中在第二段。\n下一轮假设：B版要求具体行动。\n')
      expect(aMeta).toMatchObject({ complete: true, status: 'complete', stepId: 'prose' })
      expect(bMeta).toMatchObject({ complete: true, status: 'complete', stepId: 'prose' })
      expect(aInput).toEqual(bInput)
      expect(aInput).toMatchObject({ input })
      expect(aInvocation.system).toContain('A版'); expect(bInvocation.system).toContain('B版')
      expect(aInvocation.prompt).toBe(bInvocation.prompt)
      expect(aResult).toMatchObject({ status: 'succeeded', content: { text: 'A版正文：第二段仍需调整。' } })
      expect(bResult).toMatchObject({ status: 'succeeded', content: { text: 'B版正文：第二段更具体。' } })
      expect(readRecord(aDir, 'result.json')).toEqual(aResult)
      expect(readFileSync(join(directory, 'comments.md'), 'utf8')).toContain('用户原话：')
      expect(readFileSync(join(directory, 'comments.md'), 'utf8')).toContain('Agent观察：')
      expect(requests).toHaveLength(2)
      for (const dir of [aDir, bDir]) for (const file of ['input.json', 'invocation.json', 'meta.json', 'result.json']) {
        expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600)
      }
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('rejects a colliding or symlink record directory without contacting the provider', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-record-path-'))
    let calls = 0
    const server = createServer((_req, res) => { calls++; res.writeHead(500); res.end() })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'record path seed')
      const existing = join(directory, 'existing'); writeFileSync(existing, 'must remain')
      for (const recordDir of [existing, join(directory, 'link')]) {
        if (recordDir.endsWith('/link')) symlinkSync(existing, recordDir)
        const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--record-dir', recordDir], `http://127.0.0.1:${address.port}/v1`)
        expect(result.code).toBe(1)
        expect(JSON.parse(result.stderr).code).toMatch(/recording-/)
      }
      expect(readFileSync(existing, 'utf8')).toBe('must remain')
      expect(calls).toBe(0)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('rejects a record directory with a symlink parent without contacting the provider or changing the real parent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-record-parent-link-'))
    let calls = 0
    const server = createServer((_req, res) => { calls++; res.writeHead(500); res.end() })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    try {
      const seedFile = join(directory, 'seed.txt'); writeFileSync(seedFile, 'record parent link seed')
      const realParent = join(directory, 'real-parent'); mkdirSync(realParent)
      const existing = join(realParent, 'existing'); writeFileSync(existing, 'must remain')
      const parentLink = join(directory, 'parent-link'); symlinkSync(realParent, parentLink)
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--record-dir', join(parentLink, 'run-a')], `http://127.0.0.1:${address.port}/v1`)
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stderr).code).toBe('recording-path-invalid')
      expect(readFileSync(existing, 'utf8')).toBe('must remain')
      expect(readdirSync(realParent)).toEqual(['existing'])
      expect(calls).toBe(0)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

  it('runs chapter two through the executable worker with exact previous text and chapter telemetry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-continuation-'))
    const requests: { messages: { role: string; content: string }[] }[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk
      requests.push(JSON.parse(source))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-prose-two', model: 'LongCat-2.0', choices: [{ index: 0,
        message: { role: 'assistant', content: JSON.stringify({ text: '第二章正文。' }) }, finish_reason: 'stop' }] }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address')
    const beat = { title: '过桥', goal: '继续追寻', writingPlan: [{ itemId: 'item-two', title: '过桥', content: '沿桥继续走' }], ending: '发现新线索' }
    const previousChapter = { chapter: 1, beat, prose: { text: '  上章人工作者最终全文。\n\n主角站在桥头。\n' } }
    const input = { seed: '', chapter: 2, upstream: { beat, previousChapter, setting: { overview: '城市夜行',
      world: [{ itemId: 'world-one', title: '城市', content: '河流横贯城市' }], characters: [{ itemId: 'person-one', title: '主角', content: '寻找证人' }],
      factions: [], relationships: [], extensions: [],
    } } }
    try {
      const file = join(directory, 'input.json'); writeFileSync(file, JSON.stringify(input))
      const providerUrl = `http://127.0.0.1:${address.port}/v1`
      const result = await invoke(['run-step', 'prose', '--input-file', file], providerUrl)
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'succeeded', stepId: 'prose', content: { text: '第二章正文。' }, telemetry: [{ chapter: 2, ok: true }] })
      expect(requests).toHaveLength(1)
      expect(requests[0]!.messages.find(message => message.role === 'user')?.content).toContain(JSON.stringify(previousChapter))
      for (const invalid of [{ ...input, chapter: 1 }, { ...input, chapter: 3 }, { ...input, upstream: { ...input.upstream, previousChapter: undefined } }]) {
        writeFileSync(file, JSON.stringify(invalid))
        const rejected = await invoke(['run-step', 'prose', '--input-file', file], providerUrl)
        expect(rejected.code).toBe(1)
        expect(JSON.parse(rejected.stderr)).toMatchObject({ code: 'invalid-input' })
        expect(rejected.stderr).not.toContain(previousChapter.prose.text)
      }
      expect(requests).toHaveLength(1)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 20000)

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
    const directory = mkdtempSync(join(realpathSync(tmpdir()), 'a4n-step-timeout-'))
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
      const recordDir = join(directory, 'run-timeout')
      const result = await invoke(['run-step', 'caption', '--seed-file', seedFile, '--record-dir', recordDir, '--timeout-ms', '2000'], `http://127.0.0.1:${address.port}/v1`)
      expect(result.code).toBe(1); expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({ code: 'network-error', retryable: false })
      expect(calls).toBe(1)
      expect(disconnected).toBe(true)
      expect(JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8'))).toMatchObject({ status: 'unknown', content: null, diagnostic: { code: 'cli-timeout' } })
      expect(JSON.parse(readFileSync(join(recordDir, 'meta.json'), 'utf8'))).toMatchObject({ complete: false, status: 'incomplete' })
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
