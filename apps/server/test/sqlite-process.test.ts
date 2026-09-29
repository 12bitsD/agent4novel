import { afterEach, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SqliteStore } from '../src/store/sqlite-store.js'

const children: ChildProcess[] = []
const stores: SqliteStore[] = []
const directories: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a4n-sqlite-process-'))
  directories.push(dir)
  return join(dir, 'work.sqlite')
}

function open(path: string): SqliteStore {
  const store = new SqliteStore(path)
  stores.push(store)
  return store
}

async function worker(path: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/sqlite-worker.ts', import.meta.url)), path], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  children.push(child)
  let diagnostics = ''
  child.stderr!.on('data', chunk => { diagnostics += String(chunk) })
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(() => { throw new Error(`SQLite worker exited before ready: ${diagnostics}`) }),
  ])
  expect(ready).toEqual({ type: 'ready' })
  return child
}

async function send(child: ChildProcess, request: unknown): Promise<unknown> {
  const response = once(child, 'message')
  child.send(request as object)
  return (await response)[0]
}

it('serializes independent processes saving the same baseline into one success and one conflict', async () => {
  const path = databasePath()
  const store = open(path)
  const work = store.createWork({ seed: 'race' })
  const head = store.appendArtifact(work.id, 'prose', { text: 'original' }, { chapter: 1 })
  const request = { workId: work.id, kind: 'prose', chapter: 1, expectedArtifactId: head.id, expectedHeadVersion: 1, expectedHumanStatus: 'pending', content: { text: 'winner' } }
  const [first, second] = await Promise.all([worker(path), worker(path)])
  const results = await Promise.all([send(first, { action: 'save', request }), send(second, { action: 'save', request })])
  expect(results).toEqual(expect.arrayContaining([
    { type: 'result', outcome: 'committed', version: 2 },
    { type: 'result', outcome: 'version-conflict' },
  ]))
  expect(store.getWork(work.id)!.artifacts).toMatchObject([{ version: 2, content: { text: 'winner' } }])
})

it('rechecks migration and empty-bookcase initialization after concurrent processes acquire the writer lock', async () => {
  const path = databasePath()
  const [first, second] = await Promise.all([worker(path), worker(path)])
  const results = await Promise.all([send(first, { action: 'seed' }), send(second, { action: 'seed' })])
  expect(results).toEqual(expect.arrayContaining([{ type: 'result', seeded: true }, { type: 'result', seeded: false }]))
  expect(open(path).listWorks()).toHaveLength(2)
})

it('preserves acknowledged writes when the owning process is killed without closing SQLite', async () => {
  const path = databasePath()
  const child = await worker(path)
  expect(await send(child, { action: 'committed' })).toEqual({ type: 'committed' })
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  expect(open(path).listWorks()).toMatchObject([{ title: 'survives', seedPreview: 'committed before kill' }])
})

it('recovers without an uncommitted write after its independent process is killed', async () => {
  const path = databasePath()
  const store = open(path)
  const work = store.createWork({ seed: 'rollback', title: 'original title' })
  const before = store.getWork(work.id)
  store.close()
  const child = await worker(path)
  expect(await send(child, { action: 'uncommitted', workId: work.id })).toEqual({ type: 'uncommitted' })
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  expect(open(path).getWork(work.id)).toEqual(before)
})
