import { spawnSync } from 'node:child_process'
import { cliBin, cliTestEnv } from './cli-process.js'
import { describe, expect, it } from 'vitest'

describe('Prose executable CLI entry', () => {
  it('discovers complete prose request shapes before any file or network I/O', () => {
    for (const command of ['approve-prose', 'regenerate-prose', 'save-prose']) {
      const result = spawnSync(cliBin, [command, 'work-test', '--file', '/missing/request.json', '--help'], { encoding: 'utf8', env: cliTestEnv() })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(`用法: a4n ${command}`)
      expect(result.stderr).toContain('expectedArtifactId')
      expect(result.stderr).toContain('text')
      if (command === 'save-prose') expect(result.stderr).toContain('expectedHumanStatus')
      const invalid = spawnSync(cliBin, [command, 'work-test', '--unknown', 'value'], { encoding: 'utf8', env: cliTestEnv() })
      expect(invalid.status).toBe(1)
      expect(JSON.parse(invalid.stderr)).toMatchObject({ code: 'usage' })
    }
  })
})
