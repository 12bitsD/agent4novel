import { serve } from '@hono/node-server'
import { parseServerConfig } from './config/server-config.js'
import { createShutdown } from './runtime/shutdown.js'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateWebRoot, WebBuildError } from './runtime/static-web.js'

async function start(): Promise<void> {
  // Both src/start.ts and the compiled dist/start.js have this stable location.
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const config = parseServerConfig(process.env, root)
  const webRoot = config.serveWeb ? validateWebRoot(join(root, 'apps/web/dist')) : undefined
  // Import provider configuration inside this error boundary; startup diagnostics never echo its values.
  const { createProductionApp } = await import('./runtime/production-app.js')
  const { openPersistentStore } = await import('./runtime/storage.js')
  const store = openPersistentStore(config)
  try {
    const { app, demo } = createProductionApp(store, webRoot)
    const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
      const host = config.host.includes(':') ? `[${config.host}]` : config.host
      console.log(`agent4novel server listening on http://${host}:${info.port}`)
      if (demo) console.log('演示模式:未配置可用模型凭据,使用 FakeStep')
    })
    let shutdownExitCode = 0
    const stop = createShutdown(server, () => store.close(), { exit: code => process.exit(code || shutdownExitCode) })
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    server.once('error', () => {
      console.error('agent4novel server failed to listen')
      shutdownExitCode = 1
      stop()
    })
  } catch (error) {
    store.close()
    throw error
  }
}

try {
  await start()
} catch (error) {
  console.error(error instanceof WebBuildError
    ? 'agent4novel startup failed; frontend build is unavailable; run pnpm build'
    : 'agent4novel startup failed; check server, model and storage configuration')
  process.exitCode = 1
}
