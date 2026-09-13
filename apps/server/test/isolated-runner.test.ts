import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ generateObject: vi.fn(), runtime: { mode: 'live', defaultModelId: 'longcat:LongCat-2.0', requestTimeoutMs: 300000, generationSettings: () => ({ parameters: {}, options: {} }), languageModel: () => 'mock' } }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({ modelRuntime: mocks.runtime }))
import { runIsolatedStep } from '../src/steps/isolated-runner.js'
const content = { inputStage: '脑洞', summary: '合成测试', elements: [], gaps: [] }
beforeEach(() => { mocks.generateObject.mockReset(); mocks.runtime.mode = 'live' })
it('isolates concurrent system overrides and preserves production caption prompt', async () => {
  mocks.generateObject.mockImplementation(async () => ({ object: content, usage: {}, finishReason: 'stop' }))
  const results = await Promise.all(['version-a', 'version-b'].map(systemPrompt => runIsolatedStep({ stepId: 'caption', input: { seed: '合成素材' }, systemPrompt })))
  expect(results.map(r => r.kind)).toEqual(['succeeded', 'succeeded'])
  expect(results[0]!.runId).not.toBe(results[1]!.runId)
  expect(mocks.generateObject.mock.calls.map(([call]) => call.system)).toEqual(['version-a', 'version-b'])
  for (const [call] of mocks.generateObject.mock.calls) {
    expect(call.prompt).toBe('作者原始素材:\n合成素材\n\n请输出提炼稿。')
    expect(call.maxOutputTokens).toBe(8000)
    expect(call.maxRetries).toBeUndefined()
  }
})
it('rejects missing upstream without a model call', async () => {
  expect(await runIsolatedStep({ stepId: 'outline', input: { seed: '合成素材' } })).toMatchObject({ kind: 'failed', code: 'invalid-input' })
  expect(mocks.generateObject).not.toHaveBeenCalled()
})
it('rejects absent credentials instead of using demo output', async () => {
  mocks.runtime.mode = 'demo'
  expect(await runIsolatedStep({ stepId: 'caption', input: { seed: '合成素材' } })).toMatchObject({ kind: 'failed', code: 'llm-unavailable' })
  expect(mocks.generateObject).not.toHaveBeenCalled()
})
it('does not expose provider errors', async () => {
  mocks.generateObject.mockRejectedValue(new Error('PRIVATE_PROVIDER_RESPONSE'))
  const result = await runIsolatedStep({ stepId: 'caption', input: { seed: '合成素材' } })
  expect(result).toMatchObject({ kind: 'failed', code: 'llm-unavailable' })
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_RESPONSE')
})

import { runStep, creativeContentSchema, outlineContentSchema, settingContentSchema, beatContentSchema, stepExperimentRequestSchema } from '@agent4novel/contracts'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep, createFakeBeatStep } from '../src/steps/fake-step.js'
async function fixtures() {
  const base = { workId: 'synthetic', seed: '合成素材', upstream: {} }
  const caption = (await runStep(createFakeCaptionStep(), base, {})).content
  const creative = creativeContentSchema.parse((await runStep(createFakeCreativeStep(), { ...base, upstream: { caption } }, { directionCount: 1 })).content)
  const outline = outlineContentSchema.parse((await runStep(createFakeOutlineStep(), { ...base, upstream: { creative } }, {})).content)
  const setting = settingContentSchema.parse((await runStep(createFakeSettingStep(), { ...base, upstream: { caption, creative, outline } }, {})).content)
  const beat = beatContentSchema.parse((await runStep(createFakeBeatStep(), { ...base, chapter: 1, upstream: { outline, setting } }, {})).content)
  return { caption, creative, outline, setting, beat }
}
it('uses production selected-direction guard before invoking outline', async () => {
  const source = await fixtures()
  source.creative.directions.push({ ...source.creative.directions[0]!, directionId: 'second' })
  expect(await runIsolatedStep({ stepId: 'outline', input: { seed: '合成素材', upstream: { creative: source.creative } } })).toMatchObject({ kind: 'failed', code: 'direction-not-selected' })
  expect(mocks.generateObject).not.toHaveBeenCalled()
})
it.each(['creative', 'outline', 'setting', 'beat'] as const)('preserves %s production budget, context and output IDs with custom SP', async stepId => {
  const f = await fixtures()
  const raw = stepId === 'creative' ? { directions: f.creative.directions.map(({ directionId, ...d }) => d) }
    : stepId === 'outline' ? { arcs: f.outline.arcs.map(({ arcId, segments, ...arc }) => ({ ...arc, segments: segments.map(({ segmentId, ...s }) => s) })) }
    : stepId === 'setting' ? { ...f.setting, world: f.setting.world.map(({ itemId, ...v }) => v), characters: f.setting.characters.map(({ itemId, ...v }) => v), factions: [], relationships: [], extensions: [] }
    : { ...f.beat, writingPlan: f.beat.writingPlan.map(({ itemId, ...v }) => v) }
  mocks.generateObject.mockResolvedValue({ object: raw, usage: {}, finishReason: 'stop' })
  const result = await runIsolatedStep({ stepId, input: { seed: '合成素材', upstream: { caption: f.caption, creative: f.creative, outline: f.outline, setting: f.setting }, ...(stepId === 'beat' ? { chapter: 1 as const } : {}) }, config: { directionCount: 1 }, systemPrompt: 'CUSTOM_SYSTEM' })
  expect(result.kind).toBe('succeeded')
  const call = mocks.generateObject.mock.calls[0]![0]
  expect(call.system).toBe('CUSTOM_SYSTEM')
  expect(call.maxOutputTokens).toBe(stepId === 'setting' || stepId === 'outline' ? 16000 : 8000)
  expect(call.maxRetries).toBe(stepId === 'setting' || stepId === 'beat' ? 0 : undefined)
  expect(call.prompt).toContain(stepId === 'beat' ? JSON.stringify(f.outline) : '合成素材')
  if (result.kind !== 'succeeded') return
  if (stepId === 'creative') expect(creativeContentSchema.parse(result.content).directions[0]!.directionId).toContain(result.runId)
  if (stepId === 'outline') expect(outlineContentSchema.parse(result.content).arcs[0]!.arcId).toContain(result.runId)
  if (stepId === 'setting') expect(settingContentSchema.parse(result.content).world[0]!.itemId).toMatch(/^item-/)
  if (stepId === 'beat') expect(beatContentSchema.parse(result.content).writingPlan[0]!.itemId).toMatch(/^beat-item-/)
})
it('rejects store identities and unused config override channels', () => {
  for (const request of [
    { stepId: 'caption', input: { seed: 'synthetic', workId: 'production-work' } },
    { stepId: 'caption', input: { seed: 'synthetic' }, config: { systemPrompt: 'ignored' } },
    { stepId: 'caption', input: { seed: 'synthetic' }, systemPrompt: '   ' },
  ]) expect(stepExperimentRequestSchema.safeParse(request).success).toBe(false)
})
it('keeps Beat assembled-input budget with overridden system', async () => {
  const f = await fixtures()
  for (const group of [f.setting.world, f.setting.characters]) group[0]!.content = '\u0000'.repeat(20000)
  f.setting.overview = '\u0000'.repeat(20000)
  const result = await runIsolatedStep({ stepId: 'beat', input: { seed: '', chapter: 1, upstream: { outline: f.outline, setting: f.setting } }, systemPrompt: 'x'.repeat(100000) })
  expect(result).toMatchObject({ kind: 'failed', code: 'input-budget-exceeded' })
  expect(mocks.generateObject).not.toHaveBeenCalled()
})
it('validates limits and chapter semantics before invoking the model', () => {
  for (const request of [
    { stepId: 'caption', input: { seed: 'x'.repeat(1000000) } },
    { stepId: 'caption', input: { seed: '' }, systemPrompt: 'x'.repeat(100001) },
    { stepId: 'beat', input: { seed: '' } },
    { stepId: 'caption', input: { seed: '', chapter: 1 } },
  ]) expect(stepExperimentRequestSchema.safeParse(request).success).toBe(false)
})
