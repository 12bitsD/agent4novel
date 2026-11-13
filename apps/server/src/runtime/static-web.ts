import { constants, createReadStream, realpathSync, statSync } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { getMimeType } from 'hono/utils/mime'
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

export function staticWeb(directory: string): MiddlewareHandler {
  const root = validateWebRoot(directory)
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    if (/%2f/i.test(c.req.path)) return next()
    let path: string
    try { path = decodeURIComponent(c.req.path) } catch { return next() }
    if (path === '/api' || path.startsWith('/api/') || path.includes('\\') || path.includes('\0')
      || path.split('/').some(part => part.startsWith('.'))) return next()
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let stream: ReturnType<typeof createReadStream> | undefined
    try {
      const candidate = join(root, path === '/' ? 'index.html' : path)
      const expected = await stat(candidate)
      const file = await realpath(candidate)
      if (!contained(root, file)) return next()
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const stats = await handle.stat()
      if (!stats.isFile() || stats.dev !== expected.dev || stats.ino !== expected.ino || await realpath(file) !== file) {
        await handle.close()
        handle = undefined
        return next()
      }
      const size = stats.size
      let start = 0
      let end = size - 1
      let status: 200 | 206 = 200
      const range = c.req.header('range')
      if (range) {
        const reject = async () => {
          await handle?.close()
          handle = undefined
          return c.json({ code: 'invalid-range', message: 'requested range is not satisfiable', retryable: false }, 416)
        }
        const match = /^bytes=(\d+)?-(\d+)?$/.exec(range)
        if (!match) return reject()
        if (match[1] === undefined) {
          const suffix = match[2] ? Number(match[2]) : 0
          if (suffix <= 0) return reject()
          start = Math.max(size - suffix, 0)
        } else start = Number(match[1])
        const requestedEnd = match[1] !== undefined && match[2] ? Number(match[2]) : size - 1
        if (start < 0 || start >= size || requestedEnd < start) return reject()
        end = Math.min(requestedEnd, size - 1)
        status = 206
      }
      c.header('Content-Type', getMimeType(file) || 'application/octet-stream')
      c.header('Content-Length', String(status === 206 ? end - start + 1 : size))
      if (status === 206) {
        c.header('Accept-Ranges', 'bytes')
        c.header('Content-Range', `bytes ${start}-${end}/${size}`)
      }
      if (path === '/' || path === '/index.html') c.header('Cache-Control', 'no-cache')
      else if (/\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(path)) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable')
      }
      if (c.req.method === 'HEAD' || size === 0) {
        await handle.close()
        handle = undefined
        return c.body(null, status)
      }
      const opened = handle
      stream = createReadStream('', { fd: opened.fd, autoClose: false, start, end })
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        void opened.close().catch(() => {})
      }
      stream.once('end', close)
      stream.once('close', close)
      stream.once('error', close)
      handle = undefined
      return c.body(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, status)
    } catch {
      stream?.destroy()
      if (handle) await handle.close().catch(() => {})
      return next()
    }
  }
}
