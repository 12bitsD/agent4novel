import { afterEach, describe, expect, it, vi } from 'vitest'
import { advance } from './api.js'
import { postBeatCommand } from './beat-api.js'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('bounded generation request', () => {
  it('sends exactly the frozen request to the dedicated endpoint and keeps the response envelope', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ example: 'response' }), { status: 422 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = { chapter: 1 as const, expectedArtifactId: 'artifact-original', expectedHeadVersion: 1,
      content: { title: '', goal: '', writingPlan: [], ending: '' }, instructions: '',
    }
    expect(await postBeatCommand('work-test', { operation: 'regenerate-beat', request })).toEqual({ status: 422, body: { example: 'response' } })
    expect(fetchMock).toHaveBeenCalledWith('/api/works/work-test/artifacts/beat/regenerate', expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }))
  })
  it.each(['fetch', 'body'])('ends waiting even when %s hangs and ignores abort', async stuck => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => stuck === 'fetch' ? new Promise(() => {}) : ({ ok: true, json: () => new Promise(() => {}) })))
    const result = advance('work-test').catch(error => error)
    await vi.advanceTimersByTimeAsync(1_820_001)
    expect(await result).toBeInstanceOf(Error)
  })
})
