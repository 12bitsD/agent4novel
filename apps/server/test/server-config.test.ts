import { describe, expect, it } from 'vitest'
import { parseServerConfig } from '../src/config/server-config.js'

describe('persistent server configuration', () => {
  it('defaults to a repository-local database, loopback and no sample data', () => {
    expect(parseServerConfig({}, '/repo')).toEqual({
      dataDir: '/repo/.data', databasePath: '/repo/.data/agent4novel.sqlite',
      host: '127.0.0.1', port: 8787, seedDemo: false,
    })
  })
  it('resolves relative data directories against the repository and supports a random test port', () => {
    expect(parseServerConfig({ A4N_DATA_DIR: 'saved', A4N_HOST: '::1', A4N_PORT: '0', A4N_SEED_DEMO: '1' }, '/repo')).toEqual({
      dataDir: '/repo/saved', databasePath: '/repo/saved/agent4novel.sqlite', host: '::1', port: 0, seedDemo: true,
    })
    expect(parseServerConfig({ A4N_DATA_DIR: '/tmp/books', A4N_HOST: 'localhost', A4N_PORT: '65535', A4N_SEED_DEMO: '0' }, '/repo'))
      .toMatchObject({ dataDir: '/tmp/books', host: 'localhost', port: 65535, seedDemo: false })
  })
  it.each([
    ['A4N_PORT', '-1'], ['A4N_PORT', '65536'], ['A4N_PORT', '1.5'], ['A4N_PORT', '1e3'], ['A4N_PORT', 'private-token'],
    ['A4N_SEED_DEMO', 'true'], ['A4N_HOST', 'http://private-token/'], ['A4N_HOST', 'host:123'],
    ['A4N_HOST', 'a b'], ['A4N_HOST', 'a\nb'], ['A4N_DATA_DIR', '/tmp/private-token\0'],
  ])('rejects invalid %s without repeating the supplied value', (name, value) => {
    let failure: unknown
    try { parseServerConfig({ [name]: value }, '/repo') } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(name)
    expect((failure as Error).message).not.toContain(value)
  })
})
