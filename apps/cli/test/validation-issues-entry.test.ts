import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cliBin, cliTestEnv } from './cli-process.js'

type FakeRequest = { method: string; url: string; body: string }
type FakeResponse = { status: number; body: unknown }

async function invoke(args: string[], respond: (request: FakeRequest) => FakeResponse) {
  const requests: FakeRequest[] = []
  const server = createServer(async (incoming, response) => {
    let body = ''
    for await (const chunk of incoming) body += chunk
    const request = { method: incoming.method!, url: incoming.url!, body }
    requests.push(request)
    const result = respond(request)
    response.writeHead(result.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(result.body))
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    const child = spawn(cliBin, args, {
      env: cliTestEnv({ A4N_BASE_URL: `http://127.0.0.1:${address.port}` }),
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const [code] = await once(child, 'close')
    return { code, stdout, stderr, requests }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

function validationFailure(count: number) {
  return {
    code: 'invalid-content', message: 'Validation failed', retryable: false,
    issues: Array.from({ length: Math.min(count, 128) }, (_, index) => ({
      path: ['content', index], code: 'custom', message: 'invalid field',
    })),
    ...(count > 128 ? { issueCount: count, issuesTruncated: true } : {}),
  }
}

function expectValidationMetadata(stderr: string, count: number) {
  const error = JSON.parse(stderr)
  expect(error).toMatchObject({ code: 'invalid-content', retryable: false })
  expect(error.issues).toHaveLength(Math.min(count, 128))
  if (count > 128) expect(error).toMatchObject({ issueCount: count, issuesTruncated: true })
  else {
    expect(error).not.toHaveProperty('issueCount')
    expect(error).not.toHaveProperty('issuesTruncated')
  }
  return error
}

const beat = {
  id: 'beat-1', workId: 'work-test', kind: 'beat', chapter: 1, version: 1,
  humanStatus: 'pending', createdAt: '2026-10-20',
  content: {
    title: '第一章', goal: '目标',
    writingPlan: [{ itemId: 'beat-item-1', title: '安排', content: '说明' }], ending: '落点',
  },
}
const view = {
  id: 'work-test', title: '合成作品', seed: '合成素材', config: {}, createdAt: '2026-10-20',
  artifacts: [beat], workflowState: 'awaiting-beat-review', nextStepId: null,
  allowedActions: ['approve', 'regenerate'],
}
const approveRequest = {
  chapter: 1, expectedArtifactId: beat.id, expectedHeadVersion: beat.version, content: beat.content,
}
const rejectedCommand = {
  requestId: '00000000-0000-4000-8000-000000000001', operation: 'approve-beat',
  executionMode: 'demo', latencyMs: 0, kind: 'execution-result',
  target: { workId: beat.workId, kind: 'beat', chapter: 1 },
  expectedHead: { artifactId: beat.id, version: beat.version },
  writeOutcome: 'not-committed', failureStage: 'precondition', attemptIds: [],
}

describe('validation issue metadata executable entry', { timeout: 30_000 }, () => {
  it.each([1, 129])('preserves central client metadata for %s issues', async count => {
    const result = await invoke(['list'], () => ({ status: 422, body: validationFailure(count) }))
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expectValidationMetadata(result.stderr, count)
    expect(result.requests.map(request => request.method)).toEqual(['GET'])
  })

  it.each([1, 129])('preserves Beat raw response metadata for %s issues', async count => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-validation-issues-'))
    try {
      const file = join(directory, 'request.json')
      writeFileSync(file, JSON.stringify(approveRequest))
      const result = await invoke(['approve-beat', beat.workId, '--file', file], request => request.method === 'GET'
        ? { status: 200, body: view }
        : { status: 422, body: { ...validationFailure(count), command: rejectedCommand, telemetry: [] } })
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      const error = expectValidationMetadata(result.stderr, count)
      expect(error).toMatchObject({ resolution: 'rejected', hasUnknownWrite: false, command: { writeOutcome: 'not-committed' } })
      expect(result.requests.map(request => request.method)).toEqual(['GET', 'POST', 'GET'])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
