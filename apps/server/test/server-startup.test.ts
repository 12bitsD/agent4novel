import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const startup = fileURLToPath(new URL('../src/start.ts', import.meta.url))
const tsx = createRequire(import.meta.url).resolve('tsx')

describe('safe production startup', () => {
  it.each(['server', 'provider', 'storage'] as const)('fails closed for invalid %s configuration without echoing supplied values', source => {
    const root = mkdtempSync(join(tmpdir(), 'a4n-startup-'))
    const dataDir = join(root, 'private-token-data')
    try {
      if (source === 'storage') writeFileSync(dataDir, 'not a directory')
      const env = { ...process.env, A4N_DATA_DIR: dataDir, A4N_SEED_DEMO: '0', A4N_HOST: '127.0.0.1', A4N_PORT: '0',
        A4N_MODEL: '', LONGCAT_API_KEY: '', DEEPSEEK_API_KEY: '', LONGCAT_BASE_URL: '', DEEPSEEK_BASE_URL: '' }
      if (source === 'server') env.A4N_PORT = 'private-token-port'
      if (source === 'provider') env.A4N_MODEL = 'private-token-model'
      const result = spawnSync(process.execPath, ['--import', tsx, startup], { env, encoding: 'utf8', timeout: 5_000 })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('agent4novel startup failed; check server, model and storage configuration\n')
      if (source !== 'storage') expect(existsSync(dataDir)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
