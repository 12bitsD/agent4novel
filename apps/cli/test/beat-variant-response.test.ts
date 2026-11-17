import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { beatVariantSelectionResponseSchema } from '@agent4novel/contracts'
import type { BeatArtifact, BeatVariantSelectionRequest, BeatVariantSelectionResponse } from '@agent4novel/contracts'
import { cliBin, cliTestEnv } from './cli-process.js'

const artifactA: BeatArtifact = {
  id: 'beat-a', workId: 'work-test', kind: 'beat', chapter: 1, version: 1, humanStatus: 'pending',
  createdAt: '2026-10-10T00:00:00.000Z',
  content: {
    title: '旧章纲', goal: '旧目标',
    writingPlan: [{ itemId: 'item-old', title: '旧安排', content: '旧内容' }],
    ending: '旧落点',
  },
}
const artifactB: BeatArtifact = {
  ...artifactA, id: 'beat-b', version: 2,
  content: { ...artifactA.content, title: '新章纲', goal: '新目标' },
}

type Choice = BeatVariantSelectionRequest['choice']
type Options = {
  choice?: Choice
  expectedArtifactId?: string
  expectedHeadVersion?: number
  change?: (response: BeatVariantSelectionResponse) => void
}

function requestFor(choice: Choice, expectedArtifactId: string, expectedHeadVersion: number): BeatVariantSelectionRequest {
  return {
    chapter: 1, expectedArtifactId, expectedHeadVersion,
    originalArtifactId: artifactA.id, originalVersion: artifactA.version,
    originalContent: artifactA.content, choice,
  }
}

function responseFor(choice: Choice, expectedArtifactId: string, expectedHeadVersion: number): BeatVariantSelectionResponse {
  const candidate = { ...artifactB, id: expectedArtifactId, version: expectedHeadVersion }
  const artifact = choice === 'new' ? structuredClone(candidate) : {
    ...artifactA, id: 'beat-c', version: candidate.version + 1, content: structuredClone(artifactA.content),
  }
  return {
    artifact, comparison: { original: artifactA, candidate }, choice,
    selection: {
      operation: 'select-beat-variant', workId: 'work-test', chapter: 1,
      expectedHead: { artifactId: candidate.id, version: candidate.version },
      originalHead: { artifactId: artifactA.id, version: artifactA.version },
      choice, writeOutcome: choice === 'new' ? 'not-committed' : 'committed',
      resultHead: { artifactId: artifact.id, version: artifact.version, humanStatus: artifact.humanStatus },
    },
  }
}

async function invokeSelection(options: Options = {}) {
  const choice = options.choice ?? 'new'
  const expectedArtifactId = options.expectedArtifactId ?? artifactB.id
  const expectedHeadVersion = options.expectedHeadVersion ?? artifactB.version
  const request = requestFor(choice, expectedArtifactId, expectedHeadVersion)
  const response = responseFor(choice, expectedArtifactId, expectedHeadVersion)
  options.change?.(response)
  const directory = mkdtempSync(join(tmpdir(), 'a4n-beat-response-'))
  const file = join(directory, 'selection.json')
  const frozen = `${JSON.stringify(request, null, 2)}\n`
  writeFileSync(file, frozen)
  const calls: { method: string | undefined; path: string | undefined; body: unknown }[] = []
  const server = createServer(async (req, res) => {
    let source = ''
    for await (const chunk of req) source += chunk
    calls.push({ method: req.method, path: req.url, body: JSON.parse(source) })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing loopback address')
  try {
    const child = spawn(cliBin, ['select-beat-variant', 'work-test', '--file', file], {
      env: cliTestEnv({ A4N_BASE_URL: `http://127.0.0.1:${address.port}`, A4N_CLI_TIMEOUT_MS: '10000' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const [code] = await once(child, 'close')
    expect(calls).toEqual([{ method: 'POST', path: '/api/works/work-test/artifacts/beat/select', body: request }])
    expect(readFileSync(file, 'utf8')).toBe(frozen)
    return { code, stdout, stderr, response }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('select-beat-variant response correlation', () => {
  it.each(['new', 'original'] as const)('accepts a fully correlated %s selection', async choice => {
    const result = await invokeSelection({ choice })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(beatVariantSelectionResponseSchema.parse(JSON.parse(result.stdout))).toEqual(result.response)
  }, 10_000)

  const invalid: (Options & { name: string })[] = [
    { name: 'candidate content mismatch', change: value => { value.comparison.candidate.content.title = '被替换的候选' } },
    { name: 'candidate identity mismatch', change: value => { value.comparison.candidate.id = 'beat-other' } },
    { name: 'top artifact mismatch', change: value => { value.artifact.content.title = '被替换的结果' } },
    { name: 'resultHead mismatch', change: value => { value.selection.resultHead.version += 1 } },
    { name: 'non-consecutive A/B versions', expectedHeadVersion: 3 },
    { name: 'same A/B identity', expectedArtifactId: artifactA.id },
    { name: 'original work mismatch', change: value => { value.comparison.original.workId = 'other-work' } },
    { name: 'candidate chapter mismatch', change: value => { value.comparison.candidate.chapter = 2 } },
    { name: 'non-pending original', change: value => { value.comparison.original.humanStatus = 'approved' } },
    { name: 'receipt choice mismatch', change: value => { value.selection.choice = 'original' } },
    { name: 'new selection with committed outcome', change: value => { value.selection.writeOutcome = 'committed' } },
    { name: 'original selection with uncommitted outcome', choice: 'original', change: value => { value.selection.writeOutcome = 'not-committed' } },
    { name: 'original result reuses B identity', choice: 'original', change: value => {
      value.artifact.id = value.comparison.candidate.id
      value.selection.resultHead.artifactId = value.artifact.id
    } },
    { name: 'original result skips a version', choice: 'original', change: value => {
      value.artifact.version += 1
      value.selection.resultHead.version = value.artifact.version
    } },
    { name: 'original result changes frozen content', choice: 'original', change: value => { value.artifact.content.title = '被替换的 C' } },
    { name: 'original result is approved', choice: 'original', change: value => {
      value.artifact.humanStatus = 'approved'
      value.selection.resultHead.humanStatus = 'approved'
    } },
  ]

  it.each(invalid)('rejects $name as an unknown write', async options => {
    const result = await invokeSelection(options)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'invalid-response', writeOutcome: 'unknown' })
  }, 10_000)
})
