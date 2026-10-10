import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = await mkdtemp(join(tmpdir(), 'a4n-container-'))
const project = `a4n-smoke-${process.pid}-${Date.now()}`
const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(error => error ? reject(error) : resolve(address.port))
  })
})
// The smoke never loads .env.local, and inherited supplier settings cannot enable a live call.
const env = { ...process.env, A4N_HTTP_PORT: String(port), A4N_MODEL: '', LONGCAT_API_KEY: '', DEEPSEEK_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '',
  LONGCAT_BASE_URL: '', DEEPSEEK_BASE_URL: '', A4N_LLM_TIMEOUT_MS: '120000', A4N_SEED_DEMO: '0' }
async function command(file, args, { json = false, quiet = false, binary = false, input } = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, env, timeout: 600_000, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', reject)
    child.stdin.end(input)
    const chunks = []; let stderr = ''
    child.stdout.on('data', data => { chunks.push(data); if (!json && !quiet && !binary) process.stdout.write(data) })
    child.stderr.on('data', data => { stderr += data; if (!quiet) process.stderr.write(data) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${file} failed (${code}): ${stderr.slice(-3000)}`)))
  })
  return binary ? result : json ? JSON.parse(result.toString()) : result.toString()
}
const compose = (args, options) => command('docker', ['compose', '--project-name', project, '--env-file', '/dev/null', ...args], options)
const restoredProject = `${project}-restore`
const restoreFile = join(folder, 'restore.json')
const restored = (args, options) => command('docker', ['compose', '-f', 'compose.yaml', '-f', restoreFile,
  '--project-name', restoredProject, '--env-file', '/dev/null', ...args], options)
const url = `http://127.0.0.1:${port}`
const cli = args => command(join(root, 'apps/cli/bin/a4n'), [...args, '--url', url], { json: true, quiet: true })
let workId
const requestFile = join(folder, 'request.json')
async function submit(action, request) {
  await writeFile(requestFile, JSON.stringify(request))
  return cli([action, workId, '--file', requestFile])
}
const history = (runner = compose) => runner(['exec', '-T', 'app', 'node', '--input-type=module', '-e',
  "import Database from 'better-sqlite3'; const db = new Database('/data/agent4novel.sqlite', {readonly:true}); console.log(JSON.stringify(db.prepare('SELECT * FROM artifacts ORDER BY rowid').all())); db.close();"], { json: true, quiet: true })

try {
  const config = await compose(['config', '--format', 'json'], { json: true, quiet: true })
  assert.equal(config.services.app.ports[0].host_ip, '127.0.0.1')
  await compose(['up', '--build', '-d', '--wait', '--wait-timeout', '120'])
  assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { status: 'ok' })
  assert.deepEqual(await (await fetch(`${url}/api/config`)).json(), { demo: true })
  const page = await fetch(`${url}/?work=opaque-id&chapter=2`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<div id="root"><\/div>/)
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1]
  assert.ok(asset)
  assert.equal((await fetch(`${url}${asset}`)).status, 200)
  assert.equal((await fetch(`${url}/api/unknown`)).status, 404)
  assert.equal((await fetch(`${url}/.env.local`)).status, 404)
  await compose(['exec', '-T', 'app', 'node', '--input-type=module', '-e',
    "import assert from 'node:assert/strict'; import {existsSync,readdirSync} from 'node:fs'; assert.notEqual(process.getuid(),0); for(const path of ['/app/.env.local','/app/.git','/app/apps/server/src','/app/apps/server/test','/app/apps/server/node_modules/tsx']) assert.equal(existsSync(path),false,path); assert.deepEqual(readdirSync('/app/apps/server/dist/skills').sort(),['beat','caption','creative','outline','prose','setting']);"], { quiet: true })
  assert.deepEqual(await cli(['list']), [])
  const smoke = await cli(['smoke', '--seed', '容器合成验收：雨夜发现线索，翌日走到旧桥。'])
  workId = smoke.workId
  const first = smoke.final.artifacts.find(a => a.kind === 'prose' && a.chapter === 1)
  assert.equal(first.humanStatus, 'approved')
  const promptPath = join(folder, 'prompt.md'), skillPath = join(folder, 'SKILL.md')
  await writeFile(promptPath, 'Container author guidance sentinel.')
  await writeFile(skillPath, '---\nname: plain-writing\ndescription: Keep sentences clear\n---\nUse concrete actions.')
  const promptFile = await cli(['upload-prompt', workId, '--file', promptPath, '--request-id', randomUUID()])
  const skillFile = await cli(['upload-skill', workId, '--file', skillPath, '--request-id', randomUUID()])
  await submit('save-agent-config', { requestId: randomUUID(), expectedRevision: 0,
    document: { preferences: { style: 'plain' }, defaults: { systemPromptRef: promptFile.id, skills: [skillFile.id] }, steps: { caption: { skills: [], systemPromptRef: null } } } })
  await submit('start-chapter', { chapter: 2, expectedPreviousProseId: first.id, expectedPreviousProseVersion: first.version })
  const beat = await cli(['get', workId, '--kind', 'beat', '--chapter', '2'])
  await submit('approve-beat', { chapter: 2, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beat.content })
  await cli(['advance', workId])
  const prose = await cli(['get', workId, '--kind', 'prose', '--chapter', '2'])
  const fragment = prose.content.text.slice(0, 12)
  const sampleRequest = { requestId: randomUUID(), chapter: 2, sourceArtifactId: prose.id, sourceVersion: prose.version,
    sourceHash: createHash('sha256').update(prose.content.text).digest('hex'), start: 0, end: fragment.length, text: fragment, note: '容器合成坏例' }
  const sample = await submit('mark-bad-example', sampleRequest)
  const saved = await submit('save-prose', { chapter: 2, expectedArtifactId: prose.id, expectedHeadVersion: prose.version,
    expectedHumanStatus: 'pending', content: { text: '  第二章容器正文。\n\n保留空白。\n' } })
  await submit('approve-prose', { chapter: 2, expectedArtifactId: saved.artifact.id, expectedHeadVersion: saved.artifact.version, content: saved.artifact.content })
  await submit('save-prose', { chapter: 1, expectedArtifactId: first.id, expectedHeadVersion: first.version,
    expectedHumanStatus: 'approved', content: { text: `${first.content.text}\n第一章人工修订。` } })
  const before = await cli(['get', workId])
  const list = await cli(['list'])
  const rows = await history()
  const configBefore = await cli(['agent-config', workId])
  const samplesBefore = await cli(['bad-examples', workId, '--chapter', '2'])
  assert.deepEqual(samplesBefore.items, [sample])
  assert.deepEqual(await submit('mark-bad-example', sampleRequest), sample)
  const promptBefore = await cli(['get-agent-file', workId, promptFile.id])
  const skillBefore = await cli(['get-agent-file', workId, skillFile.id])
  assert.equal(before.currentChapter, 2)
  assert.equal(before.chapters[1].needsContinuityReview, true)
  assert.deepEqual(before.chapters.map(c => c.proseStatus), ['approved', 'approved'])
  assert.ok(rows.length > before.artifacts.length)
  // Remove the container, keep the entire named data volume, and create a fresh process.
  await compose(['down'])
  await compose(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120'])
  assert.deepEqual(await cli(['get', workId]), before)
  assert.deepEqual(await cli(['list']), list)
  assert.deepEqual(await history(), rows)
  assert.deepEqual(await cli(['agent-config', workId]), configBefore)
  assert.deepEqual(await cli(['get-agent-file', workId, promptFile.id]), promptBefore)
  assert.deepEqual(await cli(['get-agent-file', workId, skillFile.id]), skillBefore)
  assert.deepEqual(await cli(['bad-examples', workId, '--chapter', '2']), samplesBefore)
  assert.deepEqual(await cli(['bad-example', workId, sample.id]), sample)
  const logs = await cli(['logs', workId])
  assert.deepEqual(logs.telemetry, [])
  assert.deepEqual(logs.commands, [])
  // Execute the documented stopped-service whole-directory backup, restoring into a fresh volume.
  await compose(['stop'])
  const backup = await compose(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'tar', 'app', '-cf', '-', '-C', '/data', '.'], { binary: true, quiet: true })
  assert.ok(backup.length > 0)
  await writeFile(restoreFile, JSON.stringify({ services: { app: { image: `${project}-app` } } }))
  await restored(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'app', '-c',
    'test -z "$(ls -A /data)" && tar -xf - -C /data'], { input: backup, quiet: true })
  await restored(['up', '-d', '--wait', '--wait-timeout', '120'])
  assert.deepEqual(await cli(['get', workId]), before)
  assert.deepEqual(await cli(['list']), list)
  assert.deepEqual(await history(restored), rows)
  assert.deepEqual(await cli(['agent-config', workId]), configBefore)
  assert.deepEqual(await cli(['get-agent-file', workId, promptFile.id]), promptBefore)
  assert.deepEqual(await cli(['get-agent-file', workId, skillFile.id]), skillBefore)
  assert.deepEqual(await cli(['bad-examples', workId, '--chapter', '2']), samplesBefore)
  assert.deepEqual(await cli(['bad-example', workId, sample.id]), sample)
  console.log('PASS: same-origin Web/API, no-key two-chapter CLI, author config/files, immutable bad-example snapshot, full history and gates after recreation and stopped-directory backup/restore')
} finally {
  // Only this randomly named smoke project and its own synthetic volume are removed.
  try {
    // The restore file exists only once its project has been used.
    await writeFile(restoreFile, JSON.stringify({ services: { app: { image: `${project}-app` } } }))
    try { await restored(['down', '--volumes'], { quiet: true }) }
    finally { await compose(['down', '--volumes'], { quiet: true }) }
  }
  finally { await rm(folder, { recursive: true, force: true }) }
}
