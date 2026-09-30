import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// A compiled-runtime proof: local mock transport only, no supplier credentials or real LLM.
const root = fileURLToPath(new URL('../', import.meta.url))
const folder = await mkdtemp(join(tmpdir(), 'a4n-compiled-'))
let requests = 0
const systems = []
const caption = { inputStage: '脑洞', summary: '合成提炼稿。', elements: [{ kind: '人物', content: '主角' }], gaps: [] }
const creative = { directions: [1, 2].map(i => ({ title: `合成方向${i}`, hook: '钩子', tags: [], synopsis: '合成概要', characters: [], setting: [], payoffs: [], outline: [] })) }
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/chat/completions')
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.ok(request.messages.some(message => message.role === 'system' && message.content.length > 20))
    const system = request.messages.find(message => message.role === 'system').content
    assert.ok(system.includes('AUTHOR_GUIDANCE_SENTINEL'))
    assert.equal(request.model, 'LongCat-2.0')
    assert.equal(request.temperature, 0.25)
    assert.equal(request.top_p, 0.8)
    systems.push(system)
    requests += 1
    assert.ok(requests <= 2)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'synthetic-completion', object: 'chat.completion', model: 'LongCat-2.0',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(requests === 1 ? caption : creative) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
  } catch { res.writeHead(500); res.end('{}') }
})
let child
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const providerPort = provider.address().port
  // Foreign cwd proves both repository-root and compiled SKILL resource resolution.
  child = spawn(process.execPath, [join(root, 'apps/server/dist/start.js')], {
    cwd: folder, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, A4N_DATA_DIR: join(folder, 'data'), A4N_HOST: '127.0.0.1', A4N_PORT: '0', A4N_SEED_DEMO: '0',
      A4N_SERVE_WEB: '1', A4N_MODEL: 'longcat:LongCat-2.0', LONGCAT_API_KEY: 'synthetic-local-test', DEEPSEEK_API_KEY: '',
      LONGCAT_BASE_URL: `http://127.0.0.1:${providerPort}`, DEEPSEEK_BASE_URL: '', A4N_LLM_TIMEOUT_MS: '10000' },
  })
  let output = ''; let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`compiled startup deadline: ${stderr}`)), 10_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`compiled startup failed (${code}): ${stderr}`)) })
    child.stdout.on('data', data => {
      output += data
      const ready = /server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output)
      if (ready) { clearTimeout(timer); resolve(Number(ready[1])) }
    })
  })
  const url = `http://127.0.0.1:${port}`
  assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { status: 'ok' })
  assert.equal((await fetch(`${url}/`)).status, 200)
  const cli = args => new Promise((resolve, reject) => {
    const process = spawn(join(root, 'apps/cli/bin/a4n'), [...args, '--url', url], { cwd: folder, timeout: 20_000 })
    let stdout = ''; let stderr = ''
    process.stdout.on('data', data => { stdout += data })
    process.stderr.on('data', data => { stderr += data })
    process.once('error', reject)
    process.once('close', code => {
      if (code !== 0) return reject(new Error(`compiled CLI failed (${code}): ${stderr}`))
      try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) }
    })
  })
  const work = await cli(['create', '--seed', '编译运行合成素材'])
  const promptPath = join(folder, 'author-prompt.md'), configPath = join(folder, 'author-config.json')
  await writeFile(promptPath, 'AUTHOR_GUIDANCE_SENTINEL: concise writing.')
  const prompt = await cli(['upload-prompt', work.id, '--file', promptPath, '--request-id', randomUUID()])
  await writeFile(configPath, JSON.stringify({ requestId: randomUUID(), expectedRevision: 0,
    document: { preferences: { genre: 'mock-genre' }, defaults: { model: 'longcat:LongCat-2.0', systemPromptRef: prompt.id, temperature: 0.25, topP: 0.8 }, steps: {} } }))
  await cli(['save-agent-config', work.id, '--file', configPath])
  assert.equal((await cli(['agent-config', work.id])).revision, 1)
  const outcome = await cli(['advance', work.id])
  assert.equal(outcome.kind, 'advanced', JSON.stringify(outcome))
  assert.equal(outcome.stepId, 'creative')
  assert.equal(requests, 2)
  assert.deepEqual(outcome.telemetry.map(entry => entry.ok), [true, true])
  assert.deepEqual(outcome.telemetry.map(entry => entry.configRevision), [1, 1])
  assert.deepEqual(outcome.telemetry.map(entry => entry.configFiles), [[{ id: prompt.id, sha256: prompt.sha256 }], [{ id: prompt.id, sha256: prompt.sha256 }]])
  assert.deepEqual(outcome.telemetry.map(entry => entry.systemHash), systems.map(system => createHash('sha256').update(system).digest('hex').slice(0, 12)))
  assert.ok(!systems[0].includes('mock-genre') && systems[1].includes('mock-genre'))
  assert.ok(!output.includes('synthetic-local-test') && !stderr.includes('synthetic-local-test'))
  assert.ok(!output.includes('AUTHOR_GUIDANCE_SENTINEL') && !stderr.includes('AUTHOR_GUIDANCE_SENTINEL'))
  console.log('PASS: compiled server, same-origin Web, author revision/file hashes, actual system/model/sampling and real SDK schema via local mock transport')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 8_000)
      child.once('close', () => { clearTimeout(timer); resolve() })
      child.kill('SIGTERM')
    })
  }
  await new Promise(resolve => provider.close(resolve))
  await rm(folder, { recursive: true, force: true })
}
