import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseServerConfig } from '../src/config/server-config.js'

describe('persistent server configuration', () => {
  it('defaults to a repository-local database, loopback and no sample data', () => {
    expect(parseServerConfig({}, '/repo')).toEqual({
      dataDir: '/repo/.data', databasePath: '/repo/.data/agent4novel.sqlite',
      host: '127.0.0.1', port: 8787, seedDemo: false, serveWeb: false,
    })
  })
  it('resolves relative data directories against the repository and supports a random test port', () => {
    expect(parseServerConfig({ A4N_DATA_DIR: 'saved', A4N_HOST: '::1', A4N_PORT: '0', A4N_SEED_DEMO: '1' }, '/repo')).toEqual({
      dataDir: '/repo/saved', databasePath: '/repo/saved/agent4novel.sqlite', host: '::1', port: 0, seedDemo: true, serveWeb: false,
    })
    expect(parseServerConfig({ A4N_DATA_DIR: '/tmp/books', A4N_HOST: 'localhost', A4N_PORT: '65535', A4N_SEED_DEMO: '0' }, '/repo'))
      .toMatchObject({ dataDir: '/tmp/books', host: 'localhost', port: 65535, seedDemo: false })
  })
  it('enables the compiled Web only with the explicit production switch', () => {
    expect(parseServerConfig({ A4N_SERVE_WEB: '1' }, '/repo').serveWeb).toBe(true)
  })
  it.each([
    ['A4N_PORT', '-1'], ['A4N_PORT', '65536'], ['A4N_PORT', '1.5'], ['A4N_PORT', '1e3'], ['A4N_PORT', 'private-token'],
    ['A4N_SEED_DEMO', 'true'], ['A4N_SERVE_WEB', 'true'], ['A4N_HOST', 'http://private-token/'], ['A4N_HOST', 'host:123'],
    ['A4N_HOST', 'a b'], ['A4N_HOST', 'a\nb'], ['A4N_DATA_DIR', '/tmp/private-token\0'],
  ])('rejects invalid %s without repeating the supplied value', (name, value) => {
    let failure: unknown
    try { parseServerConfig({ [name]: value }, '/repo') } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(name)
    expect((failure as Error).message).not.toContain(value)
  })
  it('accepts loopback listeners and rejects non-loopback addresses or other hostnames outside a container', () => {
    for (const host of ['localhost', '127.0.0.0', '127.0.0.1', '127.255.255.254', '::1']) {
      expect(parseServerConfig({ A4N_HOST: host }, '/repo').host).toBe(host)
    }
    for (const host of ['0.0.0.0', '::', '192.168.1.20', '10.0.0.2', 'example.com', 'localhost.localdomain', '::ffff:127.0.0.1']) {
      expect(() => parseServerConfig({ A4N_HOST: host }, '/repo')).toThrow('A4N_HOST')
    }
  })
  it('does not infer container mode from production, Web serving or the data directory', () => {
    for (const env of [{ NODE_ENV: 'production' }, { A4N_SERVE_WEB: '1' }, { A4N_DATA_DIR: '/data' }]) {
      expect(() => parseServerConfig({ ...env, A4N_HOST: '0.0.0.0' }, '/repo')).toThrow('A4N_HOST')
    }
  })
  it('parses the container flag strictly and permits the Docker listener only in container mode', () => {
    expect(parseServerConfig({ A4N_CONTAINER: '1', A4N_HOST: '0.0.0.0' }, '/repo')).toEqual({
      dataDir: '/repo/.data', databasePath: '/repo/.data/agent4novel.sqlite',
      host: '0.0.0.0', port: 8787, seedDemo: false, serveWeb: false,
    })
    for (const value of ['true', '01', '1.0', '2', '-1']) {
      expect(() => parseServerConfig({ A4N_CONTAINER: value }, '/repo')).toThrow('A4N_CONTAINER')
    }
    expect(() => parseServerConfig({ A4N_CONTAINER: '0', A4N_HOST: '0.0.0.0' }, '/repo')).toThrow('A4N_HOST')
    expect(() => parseServerConfig({ A4N_CONTAINER: '1', A4N_HOST: '::' }, '/repo')).toThrow('A4N_HOST')
  })
  it('sets the container marker in the image and keeps Compose publishing on host loopback', () => {
    const dockerfile = readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8')
    const compose = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8')
    expect(dockerfile).toMatch(/^ENV .*A4N_CONTAINER=1(?:\s|$)/m)
    expect(compose).toContain('- "127.0.0.1:${A4N_HTTP_PORT:-8787}:8787"')
  })
})
