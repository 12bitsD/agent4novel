import type { ServerType } from '@hono/node-server'

export function createShutdown(
  server: ServerType,
  closeStore: () => void,
  options: { graceMs?: number; exit?: (code: number) => void } = {},
): () => void {
  let stopping = false
  let finished = false
  const exit = options.exit ?? process.exit
  return () => {
    if (stopping) return
    stopping = true
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      let code = 0
      try { closeStore() } catch { code = 1 }
      exit(code)
    }
    const deadline = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections()
      finish()
    }, options.graceMs ?? 5_000)
    deadline.unref()
    server.close(finish)
  }
}
