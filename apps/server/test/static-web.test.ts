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
  writeFileSync(join(webRoot, 'assets', 'app-abcdef12.js'), 'console.log("hashed fixture")')
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
  expect(page.headers.get('cache-control')).toBe('no-cache')
  expect(await page.text()).toContain('Public web fixture')
  const hashed = await app.request('/assets/app-abcdef12.js')
  expect(hashed.status).toBe(200)
  expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  expect(await hashed.text()).toContain('hashed fixture')
  const hashedHead = await app.request('/assets/app-abcdef12.js', { method: 'HEAD' })
  expect(hashedHead.status).toBe(200)
  expect(hashedHead.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
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
  for (const path of ['/api/unknown', '/%61pi/unknown', '/assets/missing.js', '/.env.local', '/%2eenv.local', '/assets/outside.txt', '/assets/%2e%2e/%2e%2e/private.txt', '/assets/%', '/assets/%00file.txt', '/assets/%5cfile.txt']) {
    const response = await app.request(path)
    expect(response.status, path).toBe(404)
    expect(await response.text(), path).not.toContain('PRIVATE_STATIC_MARKER')
  }
  const apiMiss = await app.request('/api/unknown')
  expect(apiMiss.headers.get('content-type')).toContain('application/json')
  expect(apiMiss.headers.get('cache-control')).toBeNull()
})

it('rejects encoded path separators when the encoded name points outside the Web root', async () => {
  const { folder, webRoot, deps } = fixture()
  writeFileSync(join(webRoot, 'assets', 'file.txt'), 'PUBLIC_STATIC_MARKER')
  symlinkSync(join(folder, 'private.txt'), join(webRoot, 'assets%2Ffile.txt'))
  const app = createApp({ ...deps, webRoot })

  for (const path of ['/assets%2Ffile.txt', '/assets%2ffile.txt']) {
    const response = await app.request(path)
    expect(response.status, path).toBe(404)
    expect(await response.text(), path).not.toContain('PRIVATE_STATIC_MARKER')
  }
})

it('serves the checked public file when its encoded reserved name also names an outside symlink', async () => {
  const { folder, webRoot, deps } = fixture()
  writeFileSync(join(webRoot, 'assets', 'file?.txt'), 'PUBLIC_STATIC_MARKER')
  symlinkSync(join(folder, 'private.txt'), join(webRoot, 'assets', 'file%3F.txt'))
  const app = createApp({ ...deps, webRoot })

  const response = await app.request('/assets/file%3F.txt')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('PUBLIC_STATIC_MARKER')
})

it('serves encoded public filenames without decoding their percent, space or Unicode characters again', async () => {
  const { webRoot, deps } = fixture()
  const files = [
    { name: '100%.txt', path: '/assets/100%25.txt' },
    { name: 'literal%2Fname.txt', path: '/assets/literal%252Fname.txt' },
    { name: 'chapter one.txt', path: '/assets/chapter%20one.txt' },
    { name: '章节.txt', path: '/assets/%E7%AB%A0%E8%8A%82.txt' },
  ]
  for (const { name } of files) writeFileSync(join(webRoot, 'assets', name), 'PUBLIC_STATIC_MARKER')
  const app = createApp({ ...deps, webRoot })

  for (const { path } of files) {
    const response = await app.request(path)
    expect(response.status, path).toBe(200)
    expect(response.headers.get('content-type'), path).toContain('text/plain')
    expect(await response.text(), path).toBe('PUBLIC_STATIC_MARKER')
  }
  const head = await app.request('/assets/100%25.txt', { method: 'HEAD' })
  expect(head.status).toBe(200)
  expect(head.headers.get('content-length')).toBe('20')
  expect(await head.text()).toBe('')
  const range = await app.request('/assets/literal%252Fname.txt', { headers: { range: 'bytes=0-5' } })
  expect(range.status).toBe(206)
  expect(range.headers.get('content-range')).toBe('bytes 0-5/20')
  expect(await range.text()).toBe('PUBLIC')
})

it('rejects outside symlinks whose public names contain percent-encoded characters', async () => {
  const { folder, webRoot, deps } = fixture()
  symlinkSync(join(folder, 'private.txt'), join(webRoot, 'assets', 'outside%.txt'))
  symlinkSync(join(folder, 'private.txt'), join(webRoot, 'assets', 'outside%2F.txt'))
  const app = createApp({ ...deps, webRoot })

  for (const path of ['/assets/outside%25.txt', '/assets/outside%252F.txt']) {
    const response = await app.request(path)
    expect(response.status, path).toBe(404)
    expect(await response.text(), path).not.toContain('PRIVATE_STATIC_MARKER')
  }
})

it('rejects enabling Web serving with a missing build instead of silently serving an empty site', () => {
  const { folder, deps } = fixture()
  expect(() => createApp({ ...deps, ...{ webRoot: join(folder, 'absent-build') } })).toThrow('frontend build is unavailable')
})

it('does not cache an invalid range response as a successful hashed asset', async () => {
  const { webRoot, deps } = fixture()
  const response = await createApp({ ...deps, webRoot }).request('/assets/app-abcdef12.js', { headers: { range: 'bytes=999-' } })
  expect(response.status).toBe(416)
  expect(response.headers.get('cache-control')).toBeNull()
})

it('serves suffix and exact ranges and rejects empty or zero suffixes', async () => {
  const { webRoot, deps } = fixture()
  writeFileSync(join(webRoot, 'assets', 'app-abcdef12.txt'), '01234567890123456789')
  const app = createApp({ ...deps, webRoot })
  const suffix = await app.request('/assets/app-abcdef12.txt', { headers: { range: 'bytes=-5' } })
  expect(suffix.status).toBe(206)
  expect(suffix.headers.get('content-range')).toBe('bytes 15-19/20')
  expect(suffix.headers.get('content-length')).toBe('5')
  expect(await suffix.text()).toBe('56789')
  const first = await app.request('/assets/app-abcdef12.txt', { headers: { range: 'bytes=0-0' } })
  expect(first.status).toBe(206)
  expect(first.headers.get('content-range')).toBe('bytes 0-0/20')
  expect(await first.text()).toBe('0')
  for (const range of ['bytes=-0', 'bytes=-']) {
    const response = await app.request('/assets/app-abcdef12.txt', { headers: { range } })
    expect(response.status).toBe(416)
    expect(response.headers.get('cache-control')).toBeNull()
  }
})

it('marks HTML no-cache even when index.html is a symlink inside the build', async () => {
  const { webRoot, deps } = fixture()
  rmSync(join(webRoot, 'index.html'))
  writeFileSync(join(webRoot, 'home.html'), '<!doctype html><title>Linked home</title>')
  symlinkSync(join(webRoot, 'home.html'), join(webRoot, 'index.html'))
  const response = await createApp({ ...deps, webRoot }).request('/')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-cache')
  expect(await response.text()).toContain('Linked home')
})
