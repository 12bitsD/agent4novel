import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { outlineContent } from './public-fixtures.js'
import { cliBin as bin, cliTestEnv } from './cli-process.js'

describe('approve-outline command entry', () => {
  it('advertises a side-effect-free dedicated file command and requires that file', () => {
    const help = spawnSync(bin, ['approve-outline', '--help'], { encoding: 'utf8', env: cliTestEnv() })
    expect(help.status).toBe(0)
    expect(help.stdout).toBe('')
    expect(help.stderr).toContain('approve-outline <workId> --file <f>')
    expect(help.stderr).toContain('expectedArtifactId')
    const missing = spawnSync(bin, ['approve-outline', 'work-id'], { encoding: 'utf8', env: cliTestEnv() })
    expect(missing.status).toBe(1)
    expect(missing.stdout).toBe('')
    expect(JSON.parse(missing.stderr)).toMatchObject({ code: 'usage', retryable: false })
  })
  it('rejects a request missing its visible identity before network access and preserves the file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-outline-cli-'))
    try {
      const file = join(directory, 'request.json')
      const original = JSON.stringify({ expectedHeadVersion: 1, private: 'PRIVATE_INPUT_SENTINEL' })
      writeFileSync(file, original)
      const result = spawnSync(bin, ['approve-outline', 'work-id', '--file', file], { encoding: 'utf8', env: cliTestEnv() })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({ code: 'invalid-input', retryable: false })
      expect(result.stderr).not.toContain('PRIVATE_INPUT_SENTINEL')
      expect(readFileSync(file, 'utf8')).toBe(original)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['json', 'utf8', 'oversized'] as const)('rejects %s files without exposing or rewriting their contents', kind => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-outline-file-'))
    try {
      const file = join(directory, 'request.json')
      const original = kind === 'json' ? Buffer.from('{"PRIVATE_INPUT_SENTINEL": malformed}')
        : kind === 'utf8' ? Buffer.from([0xc3, 0x28]) : Buffer.from('PRIVATE_INPUT_SENTINEL'.repeat(300))
      writeFileSync(file, original)
      const result = spawnSync(bin, ['approve-outline', 'w1', '--file', file], { encoding: 'utf8', env: cliTestEnv() })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({ code: kind === 'oversized' ? 'payload-too-large' : 'invalid-input' })
      expect(result.stderr).not.toContain('PRIVATE_INPUT_SENTINEL')
      expect(readFileSync(file)).toEqual(original)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('prints exactly one approved target as JSON through the executable with one POST and an unchanged request file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-outline-success-'))
    const request = { expectedArtifactId: 'outline-1', expectedHeadVersion: 1 }
    const approved = { id: 'outline-1', workId: 'w1', kind: 'outline', version: 1, humanStatus: 'approved', createdAt: 'original', content: outlineContent() }
    const calls: Array<{ method: string | undefined; path: string | undefined; body: unknown }> = []
    const server = createServer(async (incoming, response) => {
      let body = ''
      for await (const chunk of incoming) body += chunk
      calls.push({ method: incoming.method, path: incoming.url, body: JSON.parse(body) })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(approved))
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address() as { port: number }
      const file = join(directory, 'request.json')
      const original = JSON.stringify(request)
      writeFileSync(file, original)
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(bin, ['approve-outline', 'w1', '--file', file, '--url', `http://127.0.0.1:${address.port}`], { env: cliTestEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = '', stderr = ''
        const timer = setTimeout(() => { child.kill(); reject(new Error('synthetic CLI deadline')) }, 10_000)
        child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(approved)
      expect(result.stderr).toBe('')
      expect(calls).toEqual([{ method: 'POST', path: '/api/works/w1/artifacts/outline/approve', body: request }])
      expect(readFileSync(file, 'utf8')).toBe(original)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(directory, { recursive: true, force: true })
    }
  })

})
