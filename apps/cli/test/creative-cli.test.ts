import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cliBin, cliTestEnv } from './cli-process.js'
import { createClient } from '../src/client.js'
import { helpFor } from '../src/command-line.js'
import { regenerateCreative } from '../src/commands.js'
import { creativeContent } from './public-fixtures.js'

const request = { expectedArtifactId: 'creative-1', expectedHeadVersion: 1, instructions: '把冲突推进得更快' }
const generated = {
  id: 'creative-2', workId: 'w1', kind: 'creative' as const, version: 2, humanStatus: 'pending' as const,
  createdAt: '2026-10-10T00:00:00.000Z', content: creativeContent('generated-direction'),
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })



async function invokeRunStep(args: string[], providerUrl: string) {
  const child = spawn(cliBin, args, { env: cliTestEnv({ A4N_MODEL: 'longcat:LongCat-2.0', LONGCAT_API_KEY: 'synthetic-step-key', LONGCAT_BASE_URL: providerUrl, A4N_CLI_TIMEOUT_MS: '10000' }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

async function invokeCli(args: string[], baseUrl: string) {
  const child = spawn(cliBin, [...args, '--url', baseUrl], { env: cliTestEnv({ A4N_BASE_URL: baseUrl, A4N_CLI_TIMEOUT_MS: '10000' }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

it('E6 runs creative regeneration through the executable and captures all four source files', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'a4n-creative-record-'))
  const requests: string[] = []
  const server = createServer(async (req, res) => {
    let source = ''; for await (const chunk of req) source += chunk
    requests.push(source)
    res.setHeader('Content-Type', 'application/json')
    const pack = (title: string) => ({ title, hook: 'new hook', tags: ['canary'], synopsis: 'new synopsis', characters: [], setting: [], payoffs: [], outline: [] })
    res.end(JSON.stringify({ id: 'creative-record', model: 'LongCat-2.0', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ directions: [pack('new-A'), pack('new-B')] }) }, finish_reason: 'stop' }] }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing provider address')
  try {
    const inputFile = join(directory, 'input.json'); const spFile = join(directory, 'creative-skill.md'); const recordDir = join(directory, 'record')
    writeFileSync(inputFile, JSON.stringify({ seed: 'CLI-REAL-SEED-CANARY', upstream: { caption: { inputStage: '脑洞', summary: 'CLI-REAL-CAPTION-CANARY', elements: [], gaps: [] } }, regeneration: {
      content: { directions: [{ directionId: 'old', title: 'CLI-OLD-PACKAGE-CANARY', hook: 'old hook', tags: [], synopsis: 'old synopsis', characters: [], setting: [], payoffs: [], outline: [] }] }, instructions: 'CLI-REAL-INSTRUCTION-CANARY',
    } }))
    writeFileSync(spFile, 'CLI-REAL-SYSTEM-CANARY')
    const result = await invokeRunStep(['run-step', 'creative', '--input-file', inputFile, '--system-prompt-file', spFile, '--record-dir', recordDir], `http://127.0.0.1:${address.port}/v1`)
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'succeeded', stepId: 'creative', recording: { status: 'complete', dir: recordDir } })
    expect(requests).toHaveLength(1)
    const invocation = JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8'))
    expect(invocation).toMatchObject({ captured: true, system: 'CLI-REAL-SYSTEM-CANARY', effectiveConfig: { model: 'longcat:LongCat-2.0' } })
    for (const value of ['CLI-REAL-SEED-CANARY', 'CLI-REAL-CAPTION-CANARY', 'CLI-OLD-PACKAGE-CANARY', 'CLI-REAL-INSTRUCTION-CANARY']) expect(invocation.prompt).toContain(value)
    expect(JSON.parse(readFileSync(join(recordDir, 'input.json'), 'utf8')).input.regeneration.instructions).toBe('CLI-REAL-INSTRUCTION-CANARY')
    expect(JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8')).status).toBe('succeeded')
    expect(JSON.parse(readFileSync(join(recordDir, 'meta.json'), 'utf8'))).toMatchObject({ complete: true, status: 'complete', stepId: 'creative' })
    expect(readdirSync(recordDir).sort()).toEqual(['input.json', 'invocation.json', 'meta.json', 'result.json'])
    expect(statSync(recordDir).mode & 0o777).toBe(0o700)
    for (const file of ['input.json', 'invocation.json', 'meta.json', 'result.json']) expect(statSync(join(recordDir, file)).mode & 0o777).toBe(0o600)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
}, 20000)

it('E6 executes regenerate-creative as a one-POST process and never retries or reads after uncertainty', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'a4n-creative-cli-'))
  const requestFile = join(directory, 'creative-request.json')
  const malformedFile = join(directory, 'malformed-request.json')
  writeFileSync(requestFile, JSON.stringify(request))
  writeFileSync(malformedFile, JSON.stringify({ ...request, extra: true }))
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const responses: Array<{ status: number; body: unknown }> = [
    { status: 200, body: generated },
    { status: 200, body: { ...generated, id: request.expectedArtifactId } },
    { status: 500, body: { code: 'internal-error', message: 'provider unavailable', retryable: false } },
  ]
  const server = createServer(async (req, res) => {
    let source = ''; for await (const chunk of req) source += chunk
    calls.push({ method: req.method ?? '', path: req.url ?? '', body: JSON.parse(source) })
    const response = responses.shift()!
    res.statusCode = response.status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response.body))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing service address')
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const malformed = await invokeCli(['regenerate-creative', 'w1', '--file', malformedFile], baseUrl)
    expect(malformed.code).toBe(1)
    expect(JSON.parse(malformed.stderr)).toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)

    const success = await invokeCli(['regenerate-creative', 'w1', '--file', requestFile], baseUrl)
    expect(success.code, success.stderr).toBe(0)
    expect(JSON.parse(success.stdout)).toMatchObject(generated)

    const mismatch = await invokeCli(['regenerate-creative', 'w1', '--file', requestFile], baseUrl)
    expect(mismatch.code).toBe(1)
    expect(JSON.parse(mismatch.stderr)).toMatchObject({ code: 'invalid-response', writeOutcome: 'unknown' })

    const unknown = await invokeCli(['regenerate-creative', 'w1', '--file', requestFile], baseUrl)
    expect(unknown.code).toBe(1)
    expect(JSON.parse(unknown.stderr)).toMatchObject({ code: 'creative-result-unknown', writeOutcome: 'unknown' })
    expect(calls).toEqual([
      { method: 'POST', path: '/api/works/w1/artifacts/creative/regenerate', body: request },
      { method: 'POST', path: '/api/works/w1/artifacts/creative/regenerate', body: request },
      { method: 'POST', path: '/api/works/w1/artifacts/creative/regenerate', body: request },
    ])

    const overlongFile = join(directory, 'overlong-step-input.json')
    writeFileSync(overlongFile, JSON.stringify({ seed: 'CLI-OVERLONG-SEED', upstream: {}, regeneration: { content: null, instructions: 'x'.repeat(4001) } }))
    const overlong = await invokeRunStep(['run-step', 'creative', '--input-file', overlongFile], baseUrl)
    expect(overlong.code, overlong.stderr).not.toBe(0)
    expect(calls).toHaveLength(3)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
}, 20000)
describe('creative regeneration CLI', () => {
  it('documents help and validates the strict request before any request', async () => {
    expect(helpFor(['regenerate-creative', '--help'])).toContain('单次 POST')
    let calls = 0
    const client = createClient({ baseUrl: 'http://local', fetch: async () => { calls++; return json(generated) } })
    await expect(regenerateCreative(client, 'w1', { ...request, extra: true })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(regenerateCreative(client, 'w1', { expectedArtifactId: null, expectedHeadVersion: 1, instructions: '' })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toBe(0)
  })

  it('makes exactly one POST with the file baseline and accepts only a new pending head', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const client = createClient({ baseUrl: 'http://local', fetch: async (url, init) => {
      calls.push({ method: init?.method ?? 'GET', path: new URL(url).pathname, body: JSON.parse(String(init?.body)) })
      return json(generated)
    } })
    await expect(regenerateCreative(client, 'w1', request)).resolves.toEqual(generated)
    expect(calls).toEqual([{ method: 'POST', path: '/api/works/w1/artifacts/creative/regenerate', body: request }])
  })

  it.each([
    { label: 'definite rejection', response: json({ code: 'version-conflict', message: 'changed', retryable: false }, 409), expected: { status: 409, code: 'version-conflict' } },
    { label: 'server failure', response: json({ code: 'internal-error', message: 'unavailable', retryable: false }, 500), expected: { status: undefined, details: { writeOutcome: 'unknown' } } },
    { label: 'invalid success', response: json({ ...generated, id: request.expectedArtifactId }), expected: { code: 'invalid-response', details: { writeOutcome: 'unknown' } } },
  ])('does not replay or read after $label', async ({ response, expected }) => {
    const methods: string[] = []
    const client = createClient({ baseUrl: 'http://local', fetch: async (_url, init) => { methods.push(init?.method ?? 'GET'); return response } })
    await expect(regenerateCreative(client, 'w1', request)).rejects.toMatchObject(expected)
    expect(methods).toEqual(['POST'])
  })
})
