import { describe, expect, it, vi } from 'vitest'
import { createCaptionStep } from '../src/steps/caption-step.js'
import { createFakeCaptionStep } from '../src/steps/fake-step.js'
import { callLlm } from '../src/steps/llm-call.js'
vi.mock('../src/steps/llm-call.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/steps/llm-call.js')>(), callLlm: vi.fn() }))

describe('author guidance reaches the real step', () => {
  it('keeps the builtin task instructions and appends configured writing guidance', async () => {
    const input = { workId: 'guidance-fixture', seed: 'source', upstream: {} }
    const fake = await createFakeCaptionStep().run(input, {})
    vi.mocked(callLlm).mockResolvedValueOnce(fake.content)
    await createCaptionStep().run(input, { systemPrompt: 'AUTHOR_GUIDANCE_SENTINEL', configRevision: 3, configFiles: [] })
    const args = vi.mocked(callLlm).mock.calls.at(-1)![0]
    expect(args.system).toContain('AUTHOR_GUIDANCE_SENTINEL')
    expect(args.system).toContain('inputStage')
    expect(args.config.configRevision).toBe(3)
  })
})
