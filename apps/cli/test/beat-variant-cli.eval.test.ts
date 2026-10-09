import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { beatArtifactSchema, beatVariantSelectionRequestSchema, beatVariantSelectionResponseSchema } from '@agent4novel/contracts'
import { cliBin as bin, cliTestEnv } from './cli-process.js'

const artifactA = { id: 'beat-a', workId: 'work-test', kind: 'beat' as const, chapter: 1, version: 1, humanStatus: 'pending' as const, createdAt: '2026-10-10T00:00:00.000Z', content: { title: '旧章纲', goal: '旧目标', writingPlan: [{ itemId: 'item-old', title: '旧安排', content: '旧内容' }], ending: '旧落点' } }
const artifactB = { ...artifactA, id: 'beat-b', version: 2, content: { ...artifactA.content, title: '新章纲', goal: '新目标' } }
const command = { requestId: '00000000-0000-4000-8000-000000000020', operation: 'select-beat-variant' as const, executionMode: 'demo' as const, latencyMs: 0, kind: 'execution-result' as const, target: { workId: 'work-test', kind: 'beat' as const, chapter: 1 }, expectedHead: { artifactId: 'beat-b', version: 2 }, writeOutcome: 'not-committed' as const, failureStage: 'response' as const, attemptIds: [], resultHead: { artifactId: 'beat-b', version: 2, humanStatus: 'pending' as const } }

async function invoke(args: string[], baseUrl: string) {
  const child = spawn(bin, args, { env: cliTestEnv({ A4N_BASE_URL: baseUrl, A4N_CLI_TIMEOUT_MS: '10000' }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close'); return { code, stdout, stderr }
}

describe('E20 CLI/Harness acceptance: beat variant selection', () => {
  it('has a strict selection request and a complete comparison receipt', () => {
    expect(beatVariantSelectionRequestSchema.shape.choice).toBeDefined()
    expect(beatVariantSelectionResponseSchema.shape.comparison).toBeDefined()
  })

  it('drives the real CLI over HTTP and exposes A/B plus pending selection without implicit approval', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-beat-variant-cli-')); const requests: unknown[] = []
    const server = createServer(async (req, res) => {
      let source = ''; for await (const chunk of req) source += chunk; if (req.method === 'POST') requests.push(JSON.parse(source))
      res.setHeader('Content-Type', 'application/json')
      if (req.url?.endsWith('/artifacts/beat/select')) {
        res.end(JSON.stringify({ artifact: artifactB, comparison: { original: artifactA, candidate: artifactB }, choice: 'new', selection: { operation: 'select-beat-variant', workId: 'work-test', chapter: 1, expectedHead: { artifactId: 'beat-b', version: 2 }, originalHead: { artifactId: 'beat-a', version: 1 }, choice: 'new', writeOutcome: 'not-committed', resultHead: { artifactId: 'beat-b', version: 2, humanStatus: 'pending' } }, command, workflow: { workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }, telemetry: [] }))
      } else if (req.url?.endsWith('/api/works/work-test')) {
        res.end(JSON.stringify({ id: 'work-test', title: '作品', seed: '素材', config: {}, createdAt: '2026-10-10', artifacts: [artifactB], workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }))
      } else { res.writeHead(404); res.end(JSON.stringify({ code: 'not-found', message: 'not found' })) }
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address')
    try {
      const input = join(directory, 'selection.json'); writeFileSync(input, JSON.stringify({ chapter: 1, expectedArtifactId: 'beat-b', expectedHeadVersion: 2, originalArtifactId: 'beat-a', originalVersion: 1, originalContent: artifactA.content, choice: 'new' }))
      const result = await invoke(['select-beat-variant', 'work-test', '--file', input], `http://127.0.0.1:${address.port}`)
      expect(result.code, result.stderr).toBe(0); const output = JSON.parse(result.stdout)
      expect(output.comparison).toEqual({ original: artifactA, candidate: artifactB }); expect(output.artifact.humanStatus).toBe('pending'); expect(output.selection.writeOutcome).toBe('not-committed')
      expect(requests).toEqual([expect.objectContaining({ choice: 'new', originalArtifactId: 'beat-a', originalVersion: 1 })])
      expect(beatArtifactSchema.parse(output.artifact).id).toBe('beat-b')
      expect(readdirSync(directory)).toContain('selection.json')
      expect(JSON.parse(readFileSync(input, 'utf8')).choice).toBe('new')
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  })
})
