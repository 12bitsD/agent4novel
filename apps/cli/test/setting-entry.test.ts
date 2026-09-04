import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../bin/a4n', import.meta.url))

describe('approve-setting command entry', () => {
  it('rejects a malformed request file without echoing its contents or changing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-setting-cli-'))
    try {
      const file = join(directory, 'request.json')
      const original = '{"private-input-sentinel": malformed}'
      writeFileSync(file, original)
      const result = spawnSync(bin, ['approve-setting', 'w1', '--file', file], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('"code":"invalid-input"')
      expect(result.stderr).not.toContain('private-input-sentinel')
      expect(readFileSync(file, 'utf8')).toBe(original)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires the explicit version in a JSON file before contacting a server', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-setting-cli-'))
    try {
      const file = join(directory, 'request.json')
      const original = JSON.stringify({ content: { overview: 'private-input-sentinel' } })
      writeFileSync(file, original)
      const result = spawnSync(bin, ['approve-setting', 'w1', '--file', file], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stderr)).toMatchObject({ code: 'invalid-input', retryable: false })
      expect(result.stderr).not.toContain('private-input-sentinel')
      expect(readFileSync(file, 'utf8')).toBe(original)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires --file and advertises the dedicated command', () => {
    const missing = spawnSync(bin, ['approve-setting', 'w1'], { encoding: 'utf8' })
    expect(missing.status).toBe(1)
    expect(JSON.parse(missing.stderr)).toMatchObject({ code: 'usage' })
    const help = spawnSync(bin, [], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stderr).toContain('approve-setting <workId> --file <f>')
  })
})
