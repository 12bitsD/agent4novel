import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { beatArtifactSchema, proseArtifactSchema, workViewSchema } from '@agent4novel/contracts'

it('runs the executable through two chapters, revisits the first, and explicitly starts the third without duplicating work', async () => {
  const server = spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./fixtures/prose-cli-server.ts', import.meta.url)), '--continuation'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, A4N_MODEL: '', LONGCAT_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '', DEEPSEEK_API_KEY: '' } })
  const folder = await mkdtemp(join(tmpdir(), 'a4n-continuation-cli-'))
  let output = ''; let errors = ''
  server.stderr.on('data', chunk => { errors += String(chunk) })
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture startup deadline: ${errors}`)), 10_000)
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${errors}`)) })
      server.stdout.on('data', chunk => { output += String(chunk); const line = output.split('\n').find(line => line.includes('"fixtureReady":true')); if (line) { clearTimeout(timer); resolve(JSON.parse(line).port) } })
    })
    const cli = async (args: string[]) => {
      const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(fileURLToPath(new URL('../../cli/bin/a4n', import.meta.url)), [...args, '--url', `http://127.0.0.1:${port}`], { timeout: 10_000 })
        let stdout = ''; let stderr = ''
        child.stdout.on('data', chunk => { stdout += String(chunk) }); child.stderr.on('data', chunk => { stderr += String(chunk) })
        child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }))
      })
      expect(result.status, result.stderr).toBe(0)
      return JSON.parse(result.stdout)
    }
    const full = await cli(['smoke', '--seed', '合成两章验收：主角在雨夜护送证人，随后沿旧桥继续寻找线索。'])
    const workId = full.workId as string
    const first = proseArtifactSchema.parse(full.final.artifacts.find((a: { kind: string }) => a.kind === 'prose'))
    const firstBeat = beatArtifactSchema.parse(full.final.artifacts.find((a: { kind: string }) => a.kind === 'beat'))
    const file = join(folder, 'request.json')
    const submit = async (command: string, request: unknown) => {
      const text = JSON.stringify(request)
      await writeFile(file, text)
      const result = await cli([command, workId, '--file', file])
      expect(await readFile(file, 'utf8')).toBe(text)
      return result
    }
    const start = { chapter: 2, expectedPreviousProseId: first.id, expectedPreviousProseVersion: first.version }
    expect(await submit('start-chapter', start)).toMatchObject({ state: { pendingGate: { kind: 'beat', chapter: 2 } } })
    const secondBeat = beatArtifactSchema.parse(await cli(['get', workId, '--kind', 'beat', '--chapter', '2']))
    expect(secondBeat.content.goal).toContain(`已通过正文（${first.content.text.length} 字）`)
    await submit('start-chapter', start)
    expect(await cli(['get', workId, '--kind', 'beat', '--chapter', '2'])).toEqual(secondBeat)
    expect(await cli(['advance', workId])).toMatchObject({ kind: 'awaiting-approval', state: { pendingGate: { kind: 'beat', chapter: 2 } } })
    await submit('approve-beat', { chapter: 2, expectedArtifactId: secondBeat.id, expectedHeadVersion: secondBeat.version, content: secondBeat.content })
    expect(await cli(['advance', workId])).toMatchObject({ state: { pendingGate: { kind: 'prose', chapter: 2 } } })
    const second = proseArtifactSchema.parse(await cli(['get', workId, '--kind', 'prose', '--chapter', '2']))
    const saved = await submit('save-prose', { chapter: 2, expectedArtifactId: second.id, expectedHeadVersion: second.version, expectedHumanStatus: 'pending', content: { text: '  第二章实际定稿：人物抵达桥对岸。\n' } })
    const approved = await submit('approve-prose', { chapter: 2, expectedArtifactId: saved.artifact.id, expectedHeadVersion: saved.artifact.version, content: saved.artifact.content })
    expect(approved.artifact).toMatchObject({ chapter: 2, humanStatus: 'approved', content: saved.artifact.content })
    expect(await cli(['get', workId, '--kind', 'prose', '--chapter', '1'])).toEqual(first)
    expect(await cli(['get', workId, '--kind', 'beat', '--chapter', '1'])).toEqual(firstBeat)
    const complete = workViewSchema.parse(await cli(['get', workId]))
    expect(complete.currentChapter).toBe(2)
    expect(complete.chapters.map(chapter => chapter.proseStatus)).toEqual(['approved', 'approved'])
    expect((await cli(['list'])).find((work: { id: string }) => work.id === workId).chapterCount).toBe(2)
    const editedFirst = await submit('save-prose', { chapter: 1, expectedArtifactId: first.id, expectedHeadVersion: first.version, expectedHumanStatus: 'approved', content: { text: `${first.content.text}\n第一章后续人工修改。` } })
    expect(editedFirst.artifact).toMatchObject({ chapter: 1, humanStatus: 'approved' })
    expect(await cli(['get', workId, '--kind', 'prose', '--chapter', '2'])).toEqual(approved.artifact)
    expect(workViewSchema.parse(await cli(['get', workId])).chapters.find(chapter => chapter.chapter === 2)?.needsContinuityReview).toBe(true)
    await submit('start-chapter', { chapter: 3, expectedPreviousProseId: approved.artifact.id, expectedPreviousProseVersion: approved.artifact.version })
    const final = workViewSchema.parse(await cli(['get', workId]))
    expect(final.currentChapter).toBe(3)
    expect(final.chapters.map(chapter => chapter.chapter)).toEqual([1, 2, 3])
    expect(final.artifacts.filter(artifact => artifact.kind === 'prose')).toHaveLength(2)
  } finally { server.kill('SIGTERM'); await rm(folder, { recursive: true, force: true }) }
}, 45_000)
