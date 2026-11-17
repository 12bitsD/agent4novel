import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { SqliteStore } from '../src/store/sqlite-store.js'

const startup = fileURLToPath(new URL('../src/start.ts', import.meta.url))
const tsx = createRequire(import.meta.url).resolve('tsx')

describe('safe production startup', () => {
  it.each(['server', 'provider', 'storage'] as const)('fails closed for invalid %s configuration without echoing supplied values', source => {
    const root = mkdtempSync(join(tmpdir(), 'a4n-startup-'))
    const dataDir = join(root, 'private-token-data')
    try {
      if (source === 'storage') writeFileSync(dataDir, 'not a directory')
      const env = { ...process.env, A4N_DATA_DIR: dataDir, A4N_SEED_DEMO: '0', A4N_HOST: '127.0.0.1', A4N_PORT: '0',
        A4N_MODEL: '', LONGCAT_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '', DEEPSEEK_API_KEY: '', LONGCAT_BASE_URL: '', KIMI_BASE_URL: '', DEEPSEEK_BASE_URL: '' }
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

  it('closes the store after a real listen conflict so it can reopen immediately', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a4n-startup-listen-conflict-'))
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('missing reservation address')
    const port = address.port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const env = { ...process.env, A4N_DATA_DIR: join(root, 'data'), A4N_SEED_DEMO: '0', A4N_HOST: '127.0.0.1', A4N_PORT: String(port),
      A4N_MODEL: '', LONGCAT_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '', DEEPSEEK_API_KEY: '', LONGCAT_BASE_URL: '', KIMI_BASE_URL: '', DEEPSEEK_BASE_URL: '' }
    const first = spawn(process.execPath, ['--import', tsx, startup], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const firstClose = once(first, 'close')
    try {
      let output = ''
      const listening = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('first server did not listen')), 5_000)
        first.stdout.on('data', chunk => {
          output += chunk
          if (output.includes('agent4novel server listening')) { clearTimeout(timer); resolve() }
        })
        first.once('error', error => { clearTimeout(timer); reject(error) })
        first.once('close', () => { clearTimeout(timer); reject(new Error('first server exited before listening')) })
      })
      await listening
      const second = spawnSync(process.execPath, ['--import', tsx, startup], { env, encoding: 'utf8', timeout: 5_000 })
      expect(second.status).toBe(1)
      expect(second.stderr).toBe('agent4novel server failed to listen\n')
      const reopened = new SqliteStore(join(root, 'data', 'agent4novel.sqlite'))
      reopened.close()
    } finally {
      try {
        if (first.exitCode === null && first.signalCode === null) first.kill('SIGTERM')
        await firstClose
        expect(first.exitCode).toBe(0)
        expect(first.signalCode).toBeNull()
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  }, 10_000)
})
