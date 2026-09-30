import { describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '../src/client.js'
import { helpFor, parseCommandLine } from '../src/command-line.js'

const input = () => ({ requestId: randomUUID(), chapter: 1, sourceArtifactId: 'artifact-source', sourceVersion: 2, sourceHash: createHash('sha256').update('片段').digest('hex'), start: 0, end: 2, text: '片段', note: '' })
describe('bad-example CLI', () => {
  it('discovers strict sample commands without replacing the supplied baseline', () => {
    expect(() => parseCommandLine(['mark-bad-example', 'work', '--file', 'sample.json'])).not.toThrow()
    expect(helpFor(['mark-bad-example', '--help'])).toContain('sourceHash')
    expect(() => parseCommandLine(['bad-examples', 'work', '--chapter', '2', '--after', '50'])).not.toThrow()
    expect(() => parseCommandLine(['bad-example', 'work', randomUUID()])).not.toThrow()
    expect(() => parseCommandLine(['mark-bad-example', 'work', '--chapter', '1'])).toThrow()
  })
  it('preserves exact input and treats a wrong selection receipt as unknown, without replay', async () => {
    const request = input()
    const fetch = vi.fn(async (_url, init) => { expect(JSON.parse(init.body)).toEqual(request); return new Response(JSON.stringify({ id: request.requestId, workId: 'work', ...Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'requestId')), text: '错段', createdAt: '2026-09-30T00:00:00Z' })) })
    const client = createClient({ baseUrl: 'http://localhost:1', fetch })
    await expect(client.markBadExample('work', request)).rejects.toMatchObject({ code: 'invalid-response', details: { writeOutcome: 'unknown' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('does not retry a lost write, and refuses a list from another chapter', async () => {
    const fetch = vi.fn(async () => { throw new Error('lost response') })
    await expect(createClient({ baseUrl: 'http://localhost:1', fetch }).markBadExample('work', input())).rejects.toMatchObject({ details: { writeOutcome: 'unknown' } })
    expect(fetch).toHaveBeenCalledOnce()
    await expect(createClient({ baseUrl: 'http://localhost:1', fetch: async () => new Response(JSON.stringify({ workId: 'work', chapter: 2, items: [] })) }).listBadExamples('work', { chapter: 1 })).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
