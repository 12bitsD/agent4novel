import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from '../src/client.js'
import { helpFor, parseCommandLine } from '../src/command-line.js'

describe('author configuration CLI contract', () => {
  it.each(['agent-config', 'save-agent-config', 'upload-skill', 'upload-prompt', 'get-agent-file'])('discovers %s and requires explicit write inputs', command => {
    expect(helpFor([command, '--help'])).toContain(`a4n ${command}`)
    const args = command === 'agent-config' ? [command, 'work'] : command === 'get-agent-file' ? [command, 'work', randomUUID()]
      : command === 'save-agent-config' ? [command, 'work', '--file', 'request.json'] : [command, 'work', '--file', 'guidance.md', '--request-id', randomUUID()]
    expect(parseCommandLine(args)._[0]).toBe(command)
    expect(() => parseCommandLine([...args, '--private-flag', 'value'])).toThrow()
  })
  it('preserves a frozen save identity and treats a wrong receipt as unknown without replay', async () => {
    const request = { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: {}, steps: {} } }
    const fetch = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toEqual(request)
      return new Response(JSON.stringify({ workId: 'other-work', requestId: request.requestId, revision: 1, document: request.document }))
    })
    const client = createClient({ baseUrl: 'http://127.0.0.1:1', fetch })
    await expect(client.saveAuthorConfig('work', request)).rejects.toMatchObject({ code: 'invalid-response', details: { writeOutcome: 'unknown' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('keeps a server failure unknown without repeating the save', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'internal-error', message: 'response unavailable', retryable: false }), { status: 500 }))
    const client = createClient({ baseUrl: 'http://127.0.0.1:1', fetch })
    await expect(client.saveAuthorConfig('work', { requestId: randomUUID(), expectedRevision: 0, document: { preferences: {}, defaults: {}, steps: {} } })).rejects.toMatchObject({ details: { writeOutcome: 'unknown' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('refuses an upload receipt whose hash does not match the submitted file', async () => {
    const id = randomUUID()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id, workId: 'work', kind: 'prompt', name: 'author-prompt', description: 'Author writing guidance', sha256: 'f'.repeat(64), byteLength: 100, createdAt: '2026-09-30T00:00:00.000Z' })))
    const client = createClient({ baseUrl: 'http://127.0.0.1:1', fetch })
    await expect(client.uploadAgentFile('work', { requestId: id, kind: 'prompt', text: 'author guidance' })).rejects.toMatchObject({ code: 'invalid-response', details: { writeOutcome: 'unknown' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
