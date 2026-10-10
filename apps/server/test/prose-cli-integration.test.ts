import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { proseArtifactSchema, proseCommandResponseSchema, diagnosticResponseSchema } from '@agent4novel/contracts'

it('runs the executable CLI from seed to edited first-chapter completion and rewrites only pending prose', async () => {
  const server = spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./fixtures/prose-cli-server.ts', import.meta.url))],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, A4N_MODEL: '', LONGCAT_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '', DEEPSEEK_API_KEY: '' } })
  const folder = await mkdtemp(join(tmpdir(), 'a4n-prose-cli-'))
  let output = ''; let errors = ''
  server.stderr.on('data', chunk => { errors += String(chunk) })
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture startup deadline: ${errors}`)), 10_000)
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${errors}`)) })
      server.stdout.on('data', chunk => { output += String(chunk); const line = output.split('\n').find(line => line.includes('"fixtureReady":true')); if (line) { clearTimeout(timer); resolve(JSON.parse(line).port) } })
    })
    const cli = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(fileURLToPath(new URL('../../cli/bin/a4n', import.meta.url)), [...args, '--url', `http://127.0.0.1:${port}`])
      let stdout = ''; let stderr = ''
      child.stdout.on('data', chunk => { stdout += String(chunk) }); child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }))
    })
    const smoke = await cli(['smoke', '--seed', '合成验收：图书管理员保护名字正在消失的借阅人。'])
    expect(smoke.status, smoke.stderr).toBe(0)
    const full = JSON.parse(smoke.stdout)
    expect(full).toMatchObject({ executionMode: 'demo', final: { workflowState: 'prose-approved' } })
    expect(full.final.artifacts.filter((a: {kind: string}) => a.kind === 'prose')).toHaveLength(1)
    expect(full.final.artifacts.some((a: {chapter?: number}) => (a.chapter ?? 0) > 1)).toBe(false)
    const complete = proseArtifactSchema.parse(full.final.artifacts.find((a: {kind: string}) => a.kind === 'prose'))
    expect(complete.content.text).toContain('作者定稿')
    expect(complete.version).toBe(2)
    expect(full.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'advance#5(prose)', ok: true }),
      expect.objectContaining({ step: 'save-prose(edited)', ok: true }),
      expect.objectContaining({ step: 'approve-prose(saved)', ok: true }),
    ]))
    const created = JSON.parse((await cli(['create', '--seed', '合成验收：一次安静的门口问答。'])).stdout)
    const file = join(folder, 'request.json')
    for (const args of [['advance', created.id], ['select', created.id], ['advance', created.id], ['approve', created.id, 'outline'], ['advance', created.id]]) expect((await cli(args)).status).toBe(0)
    const setting = JSON.parse((await cli(['get', created.id, '--kind', 'setting'])).stdout)
    await writeFile(file, JSON.stringify({ content: setting.content, expectedHeadVersion: setting.version }))
    expect((await cli(['approve-setting', created.id, '--file', file])).status).toBe(0)
    expect((await cli(['advance', created.id])).status).toBe(0)
    const beat = JSON.parse((await cli(['get', created.id, '--kind', 'beat', '--chapter', '1'])).stdout)
    expect(JSON.parse((await cli(['advance', created.id])).stdout).kind).toBe('awaiting-approval')
    await writeFile(file, JSON.stringify({ chapter: 1, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beat.content }))
    expect((await cli(['approve-beat', created.id, '--file', file])).status).toBe(0)
    const approvedBeat = JSON.parse((await cli(['get', created.id, '--kind', 'beat', '--chapter', '1'])).stdout)
    expect((await cli(['advance', created.id])).status).toBe(0)
    const pending = proseArtifactSchema.parse(JSON.parse((await cli(['get', created.id, '--kind', 'prose', '--chapter', '1'])).stdout))
    await writeFile(file, JSON.stringify({ chapter: 1, expectedArtifactId: pending.id, expectedHeadVersion: pending.version, expectedHumanStatus: 'pending', content: { text: '' } }))
    const emptySaved = await cli(['save-prose', created.id, '--file', file]); expect(emptySaved.status, emptySaved.stderr).toBe(0)
    const empty = proseCommandResponseSchema.parse(JSON.parse(emptySaved.stdout))
    expect(empty).toMatchObject({ artifact: { version: 2, humanStatus: 'pending', content: { text: '' } }, command: { operation: 'save-prose', attemptIds: [] } })
    expect(proseArtifactSchema.parse(JSON.parse((await cli(['get', created.id, '--kind', 'prose', '--chapter', '1'])).stdout))).toEqual(empty.artifact)
    const rewrite = { chapter: 1, expectedArtifactId: empty.artifact.id, expectedHeadVersion: empty.artifact.version, content: { text: '作者当前修改的正文' }, instructions: '用更安静的问答' }
    await writeFile(file, JSON.stringify(rewrite)); const original = await readFile(file, 'utf8')
    const result = await cli(['regenerate-prose', created.id, '--file', file]); expect(result.status, result.stderr).toBe(0)
    const regenerated = proseCommandResponseSchema.parse(JSON.parse(result.stdout))
    expect(regenerated.artifact).toMatchObject({ version: 3, humanStatus: 'pending' })
    expect(regenerated.artifact.content.text).toContain('作者当前修改的正文')
    expect(await readFile(file, 'utf8')).toBe(original)
    const stale = await cli(['regenerate-prose', created.id, '--file', file]); expect(stale.status).toBe(1); expect(JSON.parse(stale.stderr).code).toBe('version-conflict')
    const authorText = '  作者最终全文。\n\n空行与空白不丢失。\n'
    await writeFile(file, JSON.stringify({ chapter: 1, expectedArtifactId: regenerated.artifact.id, expectedHeadVersion: regenerated.artifact.version, content: { text: authorText } }))
    const approved = await cli(['approve-prose', created.id, '--file', file]); expect(approved.status, approved.stderr).toBe(0)
    expect(proseCommandResponseSchema.parse(JSON.parse(approved.stdout)).artifact).toMatchObject({ id: regenerated.artifact.id, version: 3, humanStatus: 'approved', content: { text: authorText } })
    const saveRequest = { chapter: 1, expectedArtifactId: regenerated.artifact.id, expectedHeadVersion: regenerated.artifact.version,
      expectedHumanStatus: 'pending', content: { text: '  通过后进一步编辑的正文。\n' },
    }
    await writeFile(file, JSON.stringify(saveRequest))
    const latePending = await cli(['save-prose', created.id, '--file', file]); expect(latePending.status).toBe(1)
    expect(JSON.parse(latePending.stderr)).toMatchObject({ code: 'version-conflict', expectedHead: { humanStatus: 'pending' }, observedHead: { humanStatus: 'approved' } })
    await writeFile(file, JSON.stringify({ ...saveRequest, expectedHumanStatus: 'approved' }))
    const savedFile = await readFile(file, 'utf8')
    const saved = await cli(['save-prose', created.id, '--file', file]); expect(saved.status, saved.stderr).toBe(0)
    const savedApproved = proseCommandResponseSchema.parse(JSON.parse(saved.stdout))
    expect(savedApproved).toMatchObject({ artifact: { version: 4, humanStatus: 'approved', content: saveRequest.content }, command: { operation: 'save-prose', attemptIds: [], expectedHead: { humanStatus: 'approved' } }, workflow: { workflowState: 'prose-approved', allowedActions: ['save-draft'] } })
    expect(savedApproved.artifact.id).not.toBe(regenerated.artifact.id)
    expect(await readFile(file, 'utf8')).toBe(savedFile)
    expect(proseArtifactSchema.parse(JSON.parse((await cli(['get', created.id, '--kind', 'prose', '--chapter', '1'])).stdout))).toEqual(savedApproved.artifact)
    const summary = JSON.parse((await cli(['list'])).stdout).find((entry: { id: string }) => entry.id === created.id)
    expect(summary.chapterCount).toBe(1)
    expect(JSON.parse((await cli(['get', created.id, '--kind', 'beat', '--chapter', '1'])).stdout)).toEqual(approvedBeat)
    const logs = await cli(['logs', created.id, '--request-id', regenerated.command.requestId]); expect(logs.status, logs.stderr).toBe(0)
    expect(diagnosticResponseSchema.parse(JSON.parse(logs.stdout)).commands).toHaveLength(1)
  } finally { server.kill('SIGTERM'); await rm(folder, { recursive: true, force: true }) }
}, 45_000)
