import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { MiddlewareHandler } from 'hono'

export class WebBuildError extends Error {
  readonly code = 'web-build-missing'
  constructor() { super('frontend build is unavailable') }
}

export function validateWebRoot(directory: string): string {
  try {
    const root = realpathSync(directory)
    const index = realpathSync(join(root, 'index.html'))
    if (!contained(root, index) || !statSync(index).isFile()) throw new WebBuildError()
    return root
  } catch { throw new WebBuildError() }
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path)
}

// Only built public files are served. Unknown API paths retain the JSON error contract.
export function staticWeb(directory: string): MiddlewareHandler {
  const root = validateWebRoot(directory)
  const serve = serveStatic({ root })
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    let path: string
    try { path = decodeURIComponent(c.req.path) } catch { return next() }
    if (path === '/api' || path.startsWith('/api/') || path.includes('\\') || path.includes('\0')
      || path.split('/').some(part => part.startsWith('.'))) return next()
    try {
      const file = realpathSync(join(root, path === '/' ? 'index.html' : path))
      if (!contained(root, file) || !statSync(file).isFile()) return next()
    } catch { return next() }
    return serve(c, next)
  }
}
