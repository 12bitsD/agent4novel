import { spawnSync } from 'node:child_process'
import { cliBin as bin, cliTestEnv } from './cli-process.js'
import { describe, expect, it } from 'vitest'
describe('Beat executable CLI entry', () => {
  it('advertises dedicated commands and returns a single error JSON for a missing request file', () => {
    const result = spawnSync(bin, ['regenerate-beat', 'work-test'], { encoding: 'utf8', env: cliTestEnv() })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
    const help = spawnSync(bin, [], { encoding: 'utf8', env: cliTestEnv() })
    expect(help.stderr).toContain('regenerate-beat')
    expect(help.stderr).toContain('--chapter')
  })
})
