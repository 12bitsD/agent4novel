import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'
import { get, runBeatCommand, smoke } from '../src/commands.js'

const beat = { id: 'artifact-one', workId: 'work-test', kind: 'beat', chapter: 1, version: 1, humanStatus: 'pending', createdAt: '2026-09-08',
  content: { title: '第一章', goal: '目标', writingPlan: [{ itemId: 'beat-item-old', title: '安排', content: '说明' }], ending: '落点' },
}
const view = { id: 'work-test', title: '合成作品', seed: '合成素材', config: {}, createdAt: '2026-09-08', artifacts: [{ ...beat, id: 'artifact-two', chapter: 2 }, beat], workflowState: 'awaiting-beat-review', nextStepId: null, allowedActions: ['approve', 'regenerate'] }
describe('Agent Beat CLI', () => {
  it('requires chapter addresses and never substitutes the first artifact of the same kind', async () => {
    const client = createClient({ baseUrl: 'http://example.test', fetch: async () => new Response(JSON.stringify(view)) })
    expect(await get(client, 'work-test', 'beat', 1)).toMatchObject({ id: 'artifact-one', chapter: 1 })
    await expect(get(client, 'work-test', 'beat')).rejects.toMatchObject({ code: 'usage' })
    await expect(get(client, 'work-test', 'setting', 1)).rejects.toMatchObject({ code: 'usage' })
  })
  it('returns conflict with an observed head after a lost regeneration response, without replaying', async () => {
    let writes = 0
    const client = createClient({ baseUrl: 'http://example.test', fetch: async (_url, init) => {
      if (init?.method === 'POST') { writes++; throw new TypeError('synthetic lost response') }
      return new Response(JSON.stringify(writes ? { ...view, artifacts: [{ ...beat, id: 'artifact-new', version: 2 }] } : view))
    } })
    await expect(runBeatCommand(client, 'work-test', 'regenerate-beat', { chapter: 1, expectedArtifactId: beat.id, expectedHeadVersion: 1, content: beat.content, instructions: '' }))
      .rejects.toMatchObject({ code: 'beat-result-conflict', details: { causeCode: 'network-error', resolution: 'conflict', observedHead: { artifactId: 'artifact-new', version: 2 } } })
    expect(writes).toBe(1)
  })
  it('includes safe partial steps and the verified execution mode when smoke fails', async () => {
    const client = createClient({ baseUrl: 'http://example.test', fetch: async url => {
      if (url.endsWith('/api/config')) return new Response(JSON.stringify({ demo: true }))
      if (url.endsWith('/api/works')) return new Response(JSON.stringify({ id: 'work-test' }))
      return new Response(JSON.stringify({ kind: 'failed', stepId: 'caption', code: 'llm-timeout', retryable: true,
        state: { workId: 'work-test', stage: 'ready', nextStepId: 'caption' }, telemetry: [] }))
    } })
    await expect(smoke(client, { seed: 'synthetic smoke' }, () => {})).rejects.toMatchObject({
      code: 'llm-timeout', details: { executionMode: 'demo', steps: [
        { step: 'config', ok: true }, { step: 'create', ok: true }, { step: 'advance#1(caption+creative)', ok: false },
      ] },
    })
  })
})
