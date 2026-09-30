import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { isIP } from 'node:net'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

export type ServerConfig = { dataDir: string; databasePath: string; host: string; port: number; seedDemo: boolean; serveWeb: boolean }

export class ServerConfigError extends Error {
  readonly code = 'server-config-invalid'
}

export function parseServerConfig(env: NodeJS.ProcessEnv, root = repositoryRoot): ServerConfig {
  const rawDirectory = env.A4N_DATA_DIR ?? ''
  if (/[\x00-\x1f\x7f]/.test(rawDirectory)) throw new ServerConfigError('A4N_DATA_DIR contains invalid characters')
  const dataDir = resolve(root, rawDirectory.trim() || '.data')
  const host = env.A4N_HOST?.trim() || '127.0.0.1'
  const hostname = host.length <= 253 && host.split('.').every(label =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
  if (!isIP(host) && !hostname) throw new ServerConfigError('A4N_HOST must be an IP address or hostname')
  const rawPort = env.A4N_PORT?.trim() || '8787'
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port > 65535) {
    throw new ServerConfigError('A4N_PORT must be an integer in the allowed port range')
  }
  const seed = env.A4N_SEED_DEMO?.trim() || '0'
  if (seed !== '0' && seed !== '1') throw new ServerConfigError('A4N_SEED_DEMO must be 0 or 1')
  const web = env.A4N_SERVE_WEB?.trim() || '0'
  if (web !== '0' && web !== '1') throw new ServerConfigError('A4N_SERVE_WEB must be 0 or 1')
  return { dataDir, databasePath: join(dataDir, 'agent4novel.sqlite'), host, port, seedDemo: seed === '1', serveWeb: web === '1' }
}
