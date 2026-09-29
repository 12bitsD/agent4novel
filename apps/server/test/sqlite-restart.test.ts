import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { beatArtifactSchema, proseArtifactSchema, workViewSchema } from '@agent4novel/contracts'

it('preserves two approved chapters, historical edits and pending prose across real production process restarts', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'a4n-sqlite-restart-'))
  const cliFile = fileURLToPath(new URL('../../cli/bin/a4n', import.meta.url))
  let server: ChildProcess | undefined
  let url = ''
  const start = async () => {
    let output = ''; let errors = ''
    // Direct production assembly avoids loading the developer's .env.local.
    const child = spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'),
      fileURLToPath(new URL('../src/start.ts', import.meta.url))], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, A4N_DATA_DIR: folder, A4N_SEED_DEMO: '0',
        A4N_HOST: '127.0.0.1', A4N_PORT: '0', A4N_MODEL: '', LONGCAT_API_KEY: '', DEEPSEEK_API_KEY: '' },
    })
    server = child
    child.stderr!.on('data', chunk => { errors += String(chunk) })
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup deadline: ${errors}`)), 10_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${errors}`)) })
      child.stdout!.on('data', chunk => {
        output += String(chunk)
        const ready = /server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output)
        if (ready) { clearTimeout(timer); resolve(Number(ready[1])) }
      })
    })
    url = `http://127.0.0.1:${port}`
  }
  const stop = async (signal: NodeJS.Signals) => {
    const child = server
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('shutdown deadline')) }, 8_000)
      child.once('close', () => { clearTimeout(timer); resolve() })
      child.kill(signal)
    })
    server = undefined
  }
  const cli = async (args: string[]) => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(cliFile, [...args, '--url', url], { timeout: 10_000 })
      let stdout = ''; let stderr = ''
      child.stdout.on('data', chunk => { stdout += String(chunk) })
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.once('error', reject)
      child.once('close', code => resolve({ code, stdout, stderr }))
    })
    expect(result.code, result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  }
  const history = () => {
    const db = new Database(join(folder, 'agent4novel.sqlite'), { readonly: true })
    try { return db.prepare('SELECT * FROM artifacts ORDER BY rowid').all() }
    finally { db.close() }
  }
  try {
    await start()
    expect(await cli(['list'])).toEqual([])
    const firstRun = await cli(['smoke', '--seed', '持久化合成验收：雨夜追踪线索，次日抵达旧桥。'])
    const workId = firstRun.workId as string
    const first = proseArtifactSchema.parse(firstRun.final.artifacts.find((a: { kind: string }) => a.kind === 'prose'))
    const requestFile = join(folder, 'request.json')
    const submit = async (command: string, request: unknown) => {
      const text = JSON.stringify(request)
      await writeFile(requestFile, text)
      const result = await cli([command, workId, '--file', requestFile])
      expect(await readFile(requestFile, 'utf8')).toBe(text)
      return result
    }
    await submit('start-chapter', { chapter: 2, expectedPreviousProseId: first.id, expectedPreviousProseVersion: first.version })
    const beat2 = beatArtifactSchema.parse(await cli(['get', workId, '--kind', 'beat', '--chapter', '2']))
    await submit('approve-beat', { chapter: 2, expectedArtifactId: beat2.id, expectedHeadVersion: beat2.version, content: beat2.content })
    await cli(['advance', workId])
    const prose2 = proseArtifactSchema.parse(await cli(['get', workId, '--kind', 'prose', '--chapter', '2']))
    const saved2 = await submit('save-prose', { chapter: 2, expectedArtifactId: prose2.id, expectedHeadVersion: prose2.version,
      expectedHumanStatus: 'pending', content: { text: '  第二章正式内容。\n\n保留空白与换行。\n' } })
    const approved2 = await submit('approve-prose', { chapter: 2, expectedArtifactId: saved2.artifact.id,
      expectedHeadVersion: saved2.artifact.version, content: saved2.artifact.content })
    await submit('save-prose', { chapter: 1, expectedArtifactId: first.id, expectedHeadVersion: first.version,
      expectedHumanStatus: 'approved', content: { text: `${first.content.text}\n第一章后续人工补充。` } })
    const start3 = { chapter: 3, expectedPreviousProseId: approved2.artifact.id, expectedPreviousProseVersion: approved2.artifact.version }
    await submit('start-chapter', start3)
    const beat3 = beatArtifactSchema.parse(await cli(['get', workId, '--kind', 'beat', '--chapter', '3']))
    await submit('approve-beat', { chapter: 3, expectedArtifactId: beat3.id, expectedHeadVersion: beat3.version, content: beat3.content })
    await cli(['advance', workId])
    const prose3 = proseArtifactSchema.parse(await cli(['get', workId, '--kind', 'prose', '--chapter', '3']))
    await submit('save-prose', { chapter: 3, expectedArtifactId: prose3.id, expectedHeadVersion: prose3.version,
      expectedHumanStatus: 'pending', content: { text: '  尚未通过的草稿\n\n' } })
    const before = workViewSchema.parse(await cli(['get', workId]))
    const listBefore = await cli(['list'])
    const rowsBefore = history()
    expect(before.currentChapter).toBe(3)
    expect(before.chapters.map(chapter => chapter.proseStatus)).toEqual(['approved', 'approved', 'pending'])
    expect(before.chapters.find(chapter => chapter.chapter === 2)?.needsContinuityReview).toBe(true)
    expect(listBefore).toMatchObject([{ id: workId, chapterCount: 2 }])
    expect(rowsBefore.length).toBeGreaterThan(before.artifacts.length)
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      await stop(signal)
      await start()
      expect(await cli(['list'])).toEqual(listBefore)
      expect(workViewSchema.parse(await cli(['get', workId]))).toEqual(before)
      expect(history()).toEqual(rowsBefore)
      const diagnostics = await cli(['logs', workId])
      expect(diagnostics.telemetry).toEqual([])
      expect(diagnostics.commands).toEqual([])
      // A readback/replayed address after restart must not launch a new model operation.
      expect(await submit('start-chapter', start3)).toMatchObject({ kind: 'awaiting-approval', telemetry: [] })
      expect(history()).toEqual(rowsBefore)
    }
  } finally {
    await stop('SIGTERM')
    await rm(folder, { recursive: true, force: true })
  }
}, 60_000)
