import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'

const control = vi.hoisted(() => ({ afterRealpath: undefined as (() => void) | undefined, closes: [] as Array<() => Promise<void>> }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual,
    realpath: async (path: string) => {
      const resolved = await actual.realpath(path)
      control.afterRealpath?.()
      control.afterRealpath = undefined
      return resolved
    },
    open: async (path: string, flags: string | number) => {
      const handle = await actual.open(path, flags)
      const close = vi.fn(handle.close.bind(handle))
      control.closes.push(close)
      handle.close = close
      return handle
    },
  }
})

afterEach(() => {
  control.afterRealpath = undefined
  control.closes = []
})

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'a4n-static-race-'))
  const webRoot = join(folder, 'web')
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Public home</title>')
  writeFileSync(join(webRoot, 'assets', 'race-abcdef12.txt'), 'PUBLIC_STATIC_MARKER')
  writeFileSync(join(folder, 'private.txt'), 'PRIVATE_STATIC_MARKER')
  const store = new InMemoryStore()
  const pipeline = new Pipeline({ store, steps: new Map(), definition: [], resolveConfig: () => ({}) })
  return { folder, webRoot, app: createApp({ store, pipeline, meta: { demo: true }, webRoot }) }
}

describe('static file validation/open race', () => {
  it.each(['GET', 'HEAD'] as const)('never serves an outside symlink installed after realpath: %s', async method => {
    const { folder, app } = fixture()
    try {
      control.afterRealpath = () => {
        rmSync(join(folder, 'web', 'assets', 'race-abcdef12.txt'))
        symlinkSync(join(folder, 'private.txt'), join(folder, 'web', 'assets', 'race-abcdef12.txt'))
      }
      const response = await app.request('/assets/race-abcdef12.txt', { method })
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBeNull()
      expect(await response.text()).not.toContain('PRIVATE_STATIC_MARKER')
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })

  it('rejects an outside directory swapped in after realpath without following its file contents', async () => {
    const { folder, app } = fixture()
    try {
      const outside = join(folder, 'outside')
      mkdirSync(outside)
      writeFileSync(join(outside, 'race-abcdef12.txt'), 'PRIVATE_STATIC_MARKER')
      control.afterRealpath = () => {
        renameSync(join(folder, 'web', 'assets'), join(folder, 'web', 'assets-original'))
        symlinkSync(outside, join(folder, 'web', 'assets'))
      }
      const response = await app.request('/assets/race-abcdef12.txt', { headers: { range: 'bytes=0-5' } })
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBeNull()
      expect(await response.text()).not.toContain('PRIVATE_STATIC_MARKER')
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })

  it('closes a directory handle before falling through to not-found', async () => {
    const { folder, app } = fixture()
    try {
      const response = await app.request('/assets')
      expect(response.status).toBe(404)
      expect(control.closes).toHaveLength(1)
      expect(control.closes[0]).toHaveBeenCalledTimes(1)
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })

  it('closes file handles after complete GET/range reads and client cancellation', async () => {
    const { folder, app } = fixture()
    try {
      const full = await app.request('/assets/race-abcdef12.txt')
      expect(await full.text()).toBe('PUBLIC_STATIC_MARKER')
      expect(control.closes).toHaveLength(1)
      expect(control.closes[0]).toHaveBeenCalledTimes(1)
      const range = await app.request('/assets/race-abcdef12.txt', { headers: { range: 'bytes=0-5' } })
      expect(range.status).toBe(206)
      expect(await range.text()).toBe('PUBLIC')
      expect(control.closes).toHaveLength(2)
      expect(control.closes[1]).toHaveBeenCalledTimes(1)
      const cancelled = await app.request('/assets/race-abcdef12.txt')
      await cancelled.body!.cancel()
      await vi.waitFor(() => expect(control.closes[2]).toHaveBeenCalledTimes(1))
      expect(control.closes).toHaveLength(3)
      expect(control.closes[2]).toHaveBeenCalledTimes(1)
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })
})
