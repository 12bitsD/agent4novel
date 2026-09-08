import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { beatArtifactSchema, beatCommandResponseSchema, diagnosticResponseSchema } from '@agent4novel/contracts'

it('drives the executable CLI through smoke, edited regeneration, approval and filtered diagnostics', async () => {
  const server = spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./fixtures/beat-cli-server.ts', import.meta.url))], { stdio: ['ignore', 'pipe', 'pipe'] })
  const folder = await mkdtemp(join(tmpdir(), 'a4n-beat-cli-'))
  let output = ''
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture start deadline exceeded')), 10_000)
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}`)) })
      server.stdout.on('data', chunk => { output += String(chunk); const line = output.split('\n').find(line => line.includes('"fixtureReady":true')); if (line) { clearTimeout(timer); resolve(JSON.parse(line).port) } })
    })
    const cli = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(fileURLToPath(new URL('../../cli/bin/a4n', import.meta.url)), [...args, '--url', `http://127.0.0.1:${port}`])
      let stdout = ''; let stderr = ''
      child.stdout.on('data', chunk => { stdout += String(chunk) }); child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }))
    })
    const smoke = await cli(['smoke', '--seed', '合成素材：在图书馆发现名字消失，先保护证人。'])
    expect(smoke.status, smoke.stderr).toBe(0)
    const full = JSON.parse(smoke.stdout)
    expect(full).toMatchObject({ executionMode: 'demo', final: { workflowState: 'beat-approved' } })
    expect(full.final.artifacts.some((a: { kind: string }) => a.kind === 'prose')).toBe(false)
    const created = JSON.parse((await cli(['create', '--seed', '合成素材：以日常对话建立关系。'])).stdout)
    for (const args of [['advance', created.id], ['select', created.id], ['advance', created.id], ['approve', created.id, 'outline'], ['advance', created.id]]) expect((await cli(args)).status).toBe(0)
    const setting = JSON.parse((await cli(['get', created.id, '--kind', 'setting'])).stdout)
    const file = join(folder, 'request.json')
    await writeFile(file, JSON.stringify({ content: setting.content, expectedHeadVersion: setting.version }))
    expect((await cli(['approve-setting', created.id, '--file', file])).status).toBe(0)
    expect((await cli(['advance', created.id])).status).toBe(0)
    const old = beatArtifactSchema.parse(JSON.parse((await cli(['get', created.id, '--kind', 'beat', '--chapter', '1'])).stdout))
    const regeneration = { chapter: 1, expectedArtifactId: old.id, expectedHeadVersion: old.version, content: { ...old.content, goal: '作者改为温和问答' }, instructions: '围绕对话，不安排追逐。' }
    await writeFile(file, JSON.stringify(regeneration))
    const originalFile = await readFile(file, 'utf8')
    const result = await cli(['regenerate-beat', created.id, '--file', file])
    expect(result.status, result.stderr).toBe(0)
    const regenerated = beatCommandResponseSchema.parse(JSON.parse(result.stdout))
    expect(regenerated.artifact).toMatchObject({ version: 2, humanStatus: 'pending' })
    expect(regenerated.artifact.content.goal).toContain('作者改为温和问答')
    expect(await readFile(file, 'utf8')).toBe(originalFile)
    const stale = await cli(['regenerate-beat', created.id, '--file', file])
    expect(stale.status).toBe(1); expect(stale.stdout).toBe(''); expect(JSON.parse(stale.stderr).code).toBe('version-conflict')
    await writeFile(file, JSON.stringify({ chapter: 1, expectedArtifactId: regenerated.artifact.id, expectedHeadVersion: 2, content: { ...regenerated.artifact.content, ending: '作者选择在安静的门口结束。' } }))
    const approved = await cli(['approve-beat', created.id, '--file', file])
    expect(approved.status, approved.stderr).toBe(0)
    expect(beatCommandResponseSchema.parse(JSON.parse(approved.stdout)).artifact).toMatchObject({ id: regenerated.artifact.id, version: 2, humanStatus: 'approved', content: { ending: '作者选择在安静的门口结束。' } })
    const logs = await cli(['logs', created.id, '--request-id', regenerated.command.requestId])
    expect(logs.status, logs.stderr).toBe(0)
    expect(diagnosticResponseSchema.parse(JSON.parse(logs.stdout)).commands).toHaveLength(1)
  } finally {
    server.kill('SIGTERM')
    await rm(folder, { recursive: true, force: true })
  }
}, 30_000)
