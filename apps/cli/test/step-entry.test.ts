import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliBin as bin, cliTestEnv } from './cli-process.js'
import { helpFor, parseCommandLine } from '../src/command-line.js'
import { describe, expect, it } from 'vitest'

describe('run-step executable entry', () => {
  it('advertises a dedicated single-node command and requires input', () => {
    const help = helpFor([])
    expect(help).toContain('run-step')
    expect(help).toContain('--thinking on|off')
    expect(help).toContain('--temperature')
    expect(help).toContain('--top-p')
    expect(help).toContain('--record-dir')
    expect(help).toContain('不支持 --top-k')
    expect(() => parseCommandLine(['run-step', 'caption'])).toThrow(
      expect.objectContaining({ code: 'usage' }),
    )
  })
  it.each(['--system-prompt-file', '--config-file'])('rejects an empty %s instead of silently using defaults', option => {
    expect(() => parseCommandLine(['run-step', 'caption', '--seed-file', 'seed.txt', option, ''])).toThrow(
      expect.objectContaining({ code: 'usage' }),
    )
  })
  it('rejects unknown flags, malformed input and oversized files without echoing contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-step-cli-'))
    try {
      const file = join(directory, 'input.json')
      writeFileSync(file, '{private-input-sentinel malformed}')
      const malformed = spawnSync(bin, ['run-step', 'caption', '--input-file', file], { encoding: 'utf8', env: cliTestEnv() })
      expect(JSON.parse(malformed.stderr)).toMatchObject({ code: 'invalid-input' })
      expect(malformed.stderr).not.toContain('private-input-sentinel')
      const unknown = spawnSync(bin, ['run-step', 'caption', '--seed-file', file, '--url', 'http://127.0.0.1:1'], { encoding: 'utf8', env: cliTestEnv() })
      expect(JSON.parse(unknown.stderr)).toMatchObject({ code: 'usage' })
      writeFileSync(file, 'x'.repeat(1024 * 1024 + 1))
      const large = spawnSync(bin, ['run-step', 'caption', '--seed-file', file], { encoding: 'utf8', env: cliTestEnv() })
      expect(JSON.parse(large.stderr)).toMatchObject({ code: 'payload-too-large' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
