import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseServerConfig } from '../src/config/server-config.js'
import { openPersistentStore } from '../src/runtime/storage.js'

describe('production storage assembly', () => {
  it('opens persistent storage by default without creating sample works', () => {
    const root = mkdtempSync(join(tmpdir(), 'a4n-runtime-store-'))
    const config = parseServerConfig({}, root)
    try {
      const first = openPersistentStore(config)
      expect(first.listWorks()).toEqual([])
      const work = first.createWork({ seed: 'saved across opens' })
      first.close()
      const next = openPersistentStore(config)
      try { expect(next.getWork(work.id)).toEqual({ ...work, artifacts: [] }) }
      finally { next.close() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('initializes explicit sample works once and preserves their identities on a new connection', () => {
    const root = mkdtempSync(join(tmpdir(), 'a4n-runtime-seed-'))
    const config = parseServerConfig({ A4N_SEED_DEMO: '1' }, root)
    try {
      const first = openPersistentStore(config)
      const samples = first.listWorks().map(work => first.getWork(work.id))
      first.close()
      expect(samples).toHaveLength(3)
      const next = openPersistentStore(config)
      try { expect(next.listWorks().map(work => next.getWork(work.id))).toEqual(samples) }
      finally { next.close() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('does not add samples to an existing author bookshelf', () => {
    const root = mkdtempSync(join(tmpdir(), 'a4n-runtime-existing-'))
    try {
      const first = openPersistentStore(parseServerConfig({}, root))
      const work = first.createWork({ seed: 'author work', title: 'Preserve this book' })
      first.close()
      const next = openPersistentStore(parseServerConfig({ A4N_SEED_DEMO: '1' }, root))
      try {
        expect(next.listWorks()).toHaveLength(1)
        expect(next.getWork(work.id)).toEqual({ ...work, artifacts: [] })
      } finally { next.close() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
