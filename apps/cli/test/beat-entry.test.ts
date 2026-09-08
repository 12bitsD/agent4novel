import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const bin = fileURLToPath(new URL('../bin/a4n', import.meta.url))
describe('Beat executable CLI entry', () => {
  it('advertises dedicated commands and returns a single error JSON for a missing request file', () => {
    const result = spawnSync(bin, ['regenerate-beat', 'work-test'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({ code: 'usage' })
    const help = spawnSync(bin, [], { encoding: 'utf8' })
    expect(help.stderr).toContain('regenerate-beat')
    expect(help.stderr).toContain('--chapter')
  })
})
