import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createShutdown } from '../src/runtime/shutdown.js'

describe('server shutdown', () => {
  it('closes the store once after accepted requests drain', async () => {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    let closes = 0
    const codes: number[] = []
    const stop = createShutdown(server, () => { closes++ }, { graceMs: 20, exit: code => codes.push(code) })
    stop()
    stop()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(closes).toBe(1)
    expect(codes).toEqual([0])
  })
  it('bounds waiting for a request that never responds', async () => {
    const server = createServer((_req, _res) => {})
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test address')
    const received = once(server, 'request')
    const req = request({ hostname: '127.0.0.1', port: address.port })
    req.on('error', () => {})
    req.end()
    await received
    let closes = 0
    const codes: number[] = []
    try {
      createShutdown(server, () => { closes++ }, { graceMs: 20, exit: code => codes.push(code) })()
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(closes).toBe(1)
      expect(codes).toEqual([0])
    } finally { req.destroy(); server.closeAllConnections(); server.close() }
  })
})
