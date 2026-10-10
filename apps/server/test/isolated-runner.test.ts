import { beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '@agent4novel/contracts'
const mocks = vi.hoisted(() => ({ generateObject: vi.fn(), runtime: { mode: 'live', defaultModelId: 'kimi:kimi-k2.8-highspeed', requestTimeoutMs: 300000, generationSettings: () => ({ parameters: {}, options: {} }), languageModel: () => 'mock' } }))
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
it('forwards creative regeneration through the run-step worker into the production prompt', async () => {
  const f = await fixtures()
  const regenerated = { directions: f.creative.directions.map(({ directionId, ...value }) => value) }
  mocks.generateObject.mockResolvedValue({ object: regenerated, usage: {}, finishReason: 'stop' })
  const result = await runIsolatedStep({
    stepId: 'creative',
    input: { seed: '合成素材', upstream: { caption: f.caption }, regeneration: { content: f.creative, instructions: '把冲突推进得更快' } },
    config: { directionCount: 1 },
  })
  expect(result.kind).toBe('succeeded')
  expect(mocks.generateObject).toHaveBeenCalledTimes(1)
  const call = mocks.generateObject.mock.calls[0]![0]
  expect(call.prompt).toContain('当前已保存方向包(仅供本次再生参考):')
  expect(call.prompt).toContain(JSON.stringify(f.creative, null, 2))
  expect(call.prompt).toContain('作者补充想法:\n把冲突推进得更快')
})
it('does not expose provider errors', async () => {
  mocks.generateObject.mockRejectedValue(new Error('PRIVATE_PROVIDER_RESPONSE'))
  const result = await runIsolatedStep({ stepId: 'caption', input: { seed: '合成素材' } })
  expect(result).toMatchObject({ kind: 'failed', code: 'llm-unavailable' })
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_RESPONSE')
})

import { runStep, creativeContentSchema, outlineContentSchema, settingContentSchema, beatContentSchema, stepExperimentRequestSchema } from '@agent4novel/contracts'
import type { StepExperimentRequest } from '@agent4novel/contracts'
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
  const upstream: Record<string, JsonValue> = stepId === 'beat' ? { outline: f.outline, setting: f.setting } : { caption: f.caption, creative: f.creative, outline: f.outline, setting: f.setting }
  const result = await runIsolatedStep({ stepId, input: { seed: '合成素材', upstream, ...(stepId === 'beat' ? { chapter: 1 as const } : {}) }, config: { directionCount: 1 }, systemPrompt: 'CUSTOM_SYSTEM' })
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

it('records the actual SDK invocation and final step result only when explicitly requested', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4n-step-record-server-'))
  const recordDir = join(directory, 'run-a')
  mkdirSync(recordDir, { mode: 0o700 })
  mocks.runtime.generationSettings = () => ({
    parameters: { temperature: 0.4, topP: 0.6 },
    options: { temperature: 0.4, topP: 0.6 },
  })
  mocks.generateObject.mockResolvedValue({ object: content, usage: {}, finishReason: 'stop' })
  try {
    const result = await runIsolatedStep({ stepId: 'caption', input: { seed: 'recorded seed' },
      systemPrompt: 'recorded system', config: { model: 'kimi:kimi-k2.8-highspeed' },
      record: { dir: recordDir, sources: { input: 'seed-file', inputPath: '/private/seed.txt', systemPromptPath: '/private/sp.md', configPath: null }, version: { gitCommit: 'a'.repeat(40), gitDirty: true } },
    } as never)
    expect(result).toMatchObject({ kind: 'succeeded', recording: { status: 'complete', dir: recordDir } })
    expect(readdirSync(recordDir).sort()).toEqual(['input.json', 'invocation.json', 'meta.json', 'result.json'])
    const input = JSON.parse(readFileSync(join(recordDir, 'input.json'), 'utf8'))
    const invocation = JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8'))
    const recordedResult = JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8'))
    const meta = JSON.parse(readFileSync(join(recordDir, 'meta.json'), 'utf8'))
    expect(input.input).toEqual({ seed: 'recorded seed' })
    expect(invocation).toMatchObject({ captured: true, system: 'recorded system', prompt: '作者原始素材:\nrecorded seed\n\n请输出提炼稿。',
      model: 'kimi:kimi-k2.8-highspeed', effectiveConfig: { model: 'kimi:kimi-k2.8-highspeed', directionCount: null, thinking: null, temperature: 0.4, topP: 0.6 },
      generation: { thinking: null, temperature: 0.4, topP: 0.6 },
      maxOutputTokens: 8000, maxRetries: null, requestTimeoutMs: 300000 })
    expect(recordedResult).toMatchObject({ status: 'succeeded', content })
    expect(meta).toMatchObject({ formatVersion: 1, complete: true, status: 'complete', stepId: 'caption', gitCommit: 'a'.repeat(40), gitDirty: true })
    expect(statSync(recordDir).mode & 0o777).toBe(0o700)
    for (const file of ['input.json', 'invocation.json', 'meta.json', 'result.json']) expect(statSync(join(recordDir, file)).mode & 0o777).toBe(0o600)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('records a pre-call validation failure without fabricating an invocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4n-step-record-failure-'))
  const recordDir = join(directory, 'run-failure')
  mkdirSync(recordDir, { mode: 0o700 })
  try {
    const result = await runIsolatedStep({ stepId: 'outline', input: { seed: 'recorded seed' },
      record: { dir: recordDir, sources: { input: 'input-file', inputPath: '/private/input.json', systemPromptPath: null, configPath: null }, version: { gitCommit: null, gitDirty: null } },
    } as never)
    expect(result).toMatchObject({ kind: 'failed', code: 'invalid-input', recording: { status: 'complete' } })
    const invocation = JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8'))
    const recordedResult = JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8'))
    expect(invocation).toEqual(expect.objectContaining({ captured: false, system: null, prompt: null, model: null, generation: null, maxOutputTokens: null, maxRetries: null }))
    expect(recordedResult).toMatchObject({ status: 'failed', content: null, diagnostic: { code: 'invalid-input' } })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it.each(['caption', 'creative', 'outline', 'setting', 'beat', 'prose'] as const)('records the actual SDK boundary for %s with nulls for omitted options', async stepId => {
  const f = await fixtures()
  const directory = mkdtempSync(join(tmpdir(), `a4n-step-record-${stepId}-`))
  const recordDir = join(directory, 'run-a')
  mkdirSync(recordDir, { mode: 0o700 })
  mocks.runtime.generationSettings = () => ({ parameters: {}, options: {} })
  const input: StepExperimentRequest['input'] = stepId === 'caption' ? { seed: '合成素材' }
    : stepId === 'creative' ? { seed: '合成素材', upstream: { caption: f.caption } }
    : stepId === 'outline' ? { seed: '合成素材', upstream: { creative: f.creative } }
    : stepId === 'setting' ? { seed: '合成素材', upstream: { caption: f.caption, creative: f.creative, outline: f.outline } }
    : { seed: '合成素材', chapter: 1, upstream: stepId === 'beat' ? { outline: f.outline, setting: f.setting } : { beat: f.beat, setting: f.setting } }
  const object = stepId === 'caption' ? f.caption
    : stepId === 'creative' ? { directions: f.creative.directions.map(({ directionId, ...value }) => value) }
    : stepId === 'outline' ? { arcs: f.outline.arcs.map(({ arcId, segments, ...arc }) => ({ ...arc, segments: segments.map(({ segmentId, ...value }) => value) })) }
    : stepId === 'setting' ? { ...f.setting, world: f.setting.world.map(({ itemId, ...value }) => value), characters: f.setting.characters.map(({ itemId, ...value }) => value) }
    : stepId === 'beat' ? { ...f.beat, writingPlan: f.beat.writingPlan.map(({ itemId, ...value }) => value) }
    : { text: '合成正文。' }
  mocks.generateObject.mockResolvedValue({ object, usage: {}, finishReason: 'stop' })
  try {
    const result = await runIsolatedStep({ stepId, input, systemPrompt: 'recorded system', config: { model: 'kimi:kimi-k2.8-highspeed', ...(stepId === 'creative' ? { directionCount: 1 } : {}) },
      record: { dir: recordDir, sources: { input: 'input-file', inputPath: '/private/input.json', systemPromptPath: '/private/sp.md', configPath: null }, version: { gitCommit: null, gitDirty: null } } })
    expect(result).toMatchObject({ kind: 'succeeded', recording: { status: 'complete', dir: recordDir } })
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
    const call = mocks.generateObject.mock.calls[0]![0]
    const invocation = JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8'))
    expect(invocation.system).toBe(call.system)
    expect(invocation.prompt).toBe(call.prompt)
    expect(invocation).toMatchObject({ model: 'kimi:kimi-k2.8-highspeed', effectiveConfig: { model: 'kimi:kimi-k2.8-highspeed', directionCount: stepId === 'creative' ? 1 : null, thinking: null, temperature: null, topP: null },
      generation: { thinking: null, temperature: null, topP: null },
      sdkOptions: { temperature: null, topP: null, providerOptions: null }, requestTimeoutMs: 300000 })
    expect(invocation.maxOutputTokens).toBe(call.maxOutputTokens)
    if (stepId === 'setting' || stepId === 'beat' || stepId === 'prose') {
      expect(invocation.maxRetries).toBe(0)
      expect(call.maxRetries).toBe(0)
    } else {
      expect(invocation.maxRetries).toBeNull()
      expect(call).not.toHaveProperty('maxRetries')
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('refuses an existing input record without calling the model or changing the original file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4n-step-record-collision-'))
  const recordDir = join(directory, 'run-a')
  mkdirSync(recordDir, { mode: 0o700 })
  const original = '{"original":true}\n'
  writeFileSync(join(recordDir, 'input.json'), original, { encoding: 'utf8', mode: 0o600 })
  try {
    const result = await runIsolatedStep({ stepId: 'caption', input: { seed: 'should not run' },
      record: { dir: recordDir, sources: { input: 'input-file', inputPath: '/private/input.json', systemPromptPath: null, configPath: null }, version: { gitCommit: null, gitDirty: null } },
    } as never)
    expect(result).toMatchObject({ kind: 'failed', code: 'recording-failed', recording: { status: 'failed' } })
    expect(readFileSync(join(recordDir, 'input.json'), 'utf8')).toBe(original)
    expect(mocks.generateObject).not.toHaveBeenCalled()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('validates limits and chapter semantics before invoking the model', () => {
  for (const request of [
    { stepId: 'caption', input: { seed: 'x'.repeat(1000000) } },
    { stepId: 'caption', input: { seed: '' }, systemPrompt: 'x'.repeat(100001) },
    { stepId: 'beat', input: { seed: '' } },
    { stepId: 'caption', input: { seed: '', chapter: 1 } },
  ]) expect(stepExperimentRequestSchema.safeParse(request).success).toBe(false)
})
