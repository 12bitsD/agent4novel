import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../bin/a4n', import.meta.url))
describe('run-step executable entry', () => {
  it('advertises a dedicated single-node command and requires input', () => {
    const help = spawnSync(bin, [], { encoding: 'utf8' }).stderr
    expect(help).toContain('run-step')
    expect(help).toContain('--thinking on|off')
    expect(help).toContain('--temperature')
    expect(help).toContain('--top-p')
    expect(help).toContain('不支持 --top-k')
    const result = spawnSync(bin, ['run-step', 'caption'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
  })
  it.each(['--system-prompt-file', '--config-file'])('rejects an empty %s instead of silently using defaults', option => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-options-'))
    try {
      const file = join(directory, 'seed.txt'); writeFileSync(file, 'synthetic seed')
      const result = spawnSync(bin, ['run-step', 'caption', '--seed-file', file, option, ''], {
        encoding: 'utf8', env: { ...process.env, A4N_MODEL: '', LONGCAT_API_KEY: '', DEEPSEEK_API_KEY: '' },
      })
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects unknown flags, malformed input and oversized files without echoing contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-cli-'))
    try {
      const file = join(directory, 'input.json')
      writeFileSync(file, '{private-input-sentinel malformed}')
      const malformed = spawnSync(bin, ['run-step', 'caption', '--input-file', file], { encoding: 'utf8' })
      expect(JSON.parse(malformed.stderr)).toMatchObject({ code: 'invalid-input' })
      expect(malformed.stderr).not.toContain('private-input-sentinel')
      const unknown = spawnSync(bin, ['run-step', 'caption', '--seed-file', file, '--url', 'http://127.0.0.1:1'], { encoding: 'utf8' })
      expect(JSON.parse(unknown.stderr)).toMatchObject({ code: 'usage' })
      writeFileSync(file, 'x'.repeat(1024 * 1024 + 1))
      const large = spawnSync(bin, ['run-step', 'caption', '--seed-file', file], { encoding: 'utf8' })
      expect(JSON.parse(large.stderr)).toMatchObject({ code: 'payload-too-large' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
