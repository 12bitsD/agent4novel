import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { emptyAgentConfig } from '@agent4novel/contracts'

const folders: string[] = []
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'a4n-static-web-'))
  folders.push(folder)
  const webRoot = join(folder, 'web')
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Public web fixture</title>')
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log("public fixture")')
  writeFileSync(join(webRoot, '.env.local'), 'PRIVATE_STATIC_MARKER')
  writeFileSync(join(folder, 'private.txt'), 'PRIVATE_STATIC_MARKER')
  symlinkSync(join(folder, 'private.txt'), join(webRoot, 'assets', 'outside.txt'))
  mkdirSync(join(webRoot, 'api'))
  writeFileSync(join(webRoot, 'api', 'unknown'), 'PRIVATE_STATIC_MARKER')
  const store = new InMemoryStore()
  const pipeline = new Pipeline({ store, steps: new Map(), definition: [], resolveConfig: () => emptyAgentConfig })
  return { folder, webRoot, deps: { store, pipeline, meta: { demo: true } } }
}

it('provides a minimal health response without exposing model or work configuration', async () => {
  const { deps } = fixture()
  const response = await createApp(deps).request('/api/health')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok' })
})

it('serves the absolute Web root and assets on the same application as the API, including HEAD', async () => {
  const { webRoot, deps } = fixture()
  const app = createApp({ ...deps, ...{ webRoot } })
  const page = await app.request('/?work=opaque-id&chapter=2')
  expect(page.status).toBe(200)
  expect(page.headers.get('content-type')).toContain('text/html')
  expect(await page.text()).toContain('Public web fixture')
  const asset = await app.request('/assets/app.js')
  expect(asset.status).toBe(200)
  expect(await asset.text()).toContain('public fixture')
  const head = await app.request('/assets/app.js', { method: 'HEAD' })
  expect(head.status).toBe(200)
  expect(await head.text()).toBe('')
  expect(await (await app.request('/api/works')).json()).toEqual([])
})

it('keeps API misses, absent assets, private names and paths outside the Web root unavailable', async () => {
  const { webRoot, deps } = fixture()
  const app = createApp({ ...deps, ...{ webRoot } })
  for (const path of ['/api/unknown', '/assets/missing.js', '/.env.local', '/%2eenv.local', '/assets/outside.txt', '/assets/%2e%2e/%2e%2e/private.txt']) {
    const response = await app.request(path)
    expect(response.status, path).toBe(404)
    expect(await response.text(), path).not.toContain('PRIVATE_STATIC_MARKER')
  }
  const apiMiss = await app.request('/api/unknown')
  expect(apiMiss.headers.get('content-type')).toContain('application/json')
})

it('rejects enabling Web serving with a missing build instead of silently serving an empty site', () => {
  const { folder, deps } = fixture()
  expect(() => createApp({ ...deps, ...{ webRoot: join(folder, 'absent-build') } })).toThrow('frontend build is unavailable')
})
