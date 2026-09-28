import { beforeEach, describe, expect, it, vi } from 'vitest'
import { proseContentSchema, runStep, settingContentSchema } from '@agent4novel/contracts'
import { createProseStep } from '../src/steps/prose-step.js'
import { resetTelemetry, telemetryFor } from '../src/steps/telemetry.js'
import { runIsolatedStep } from '../src/steps/isolated-runner.js'
import * as fake from '../src/steps/fake-step.js'
const mocks = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({ modelRuntime: { mode: 'live', defaultModelId: 'deepseek:deepseek-chat', requestTimeoutMs: 120_000, generationSettings: () => ({ parameters: {}, options: {} }), languageModel: () => 'mock-model' } }))

async function input() {
  const base = { workId: 'work-synthetic-prose', seed: '合成素材', upstream: {} }
  const caption = (await runStep(fake.createFakeCaptionStep(), base, {})).content
  const creative = (await runStep(fake.createFakeCreativeStep(), { ...base, upstream: { caption } }, { directionCount: 1 })).content
  const outline = (await runStep(fake.createFakeOutlineStep(), { ...base, upstream: { creative } }, {})).content
  const setting = (await runStep(fake.createFakeSettingStep(), { ...base, upstream: { caption, creative, outline } }, {})).content
  const beat = (await runStep(fake.createFakeBeatStep(), { ...base, chapter: 1, upstream: { outline, setting } }, {})).content
  return { ...base, seed: 'DO_NOT_USE_RAW_SEED', chapter: 1, upstream: { beat, setting } }
}
beforeEach(() => { mocks.generateObject.mockReset() })

describe('Prose generation boundary', () => {
  it('runs the production prose Step in the isolated worker with full approved inputs and current edited text', async () => {
    mocks.generateObject.mockResolvedValue({ object: { text: '  模型正文。\n\n下一段。\n' }, usage: {}, finishReason: 'stop' })
    const source = await input()
    const result = await runIsolatedStep({ stepId: 'prose', input: { seed: source.seed, chapter: 1, upstream: source.upstream,
      regeneration: { content: { text: '人工当前正文' }, instructions: '请放慢对话' } } })
    expect(result.kind).toBe('succeeded')
    if (result.kind === 'succeeded') expect(result.content).toEqual({ text: '  模型正文。\n\n下一段。\n' })
    const call = mocks.generateObject.mock.calls[0]![0]
    expect(call.prompt).toContain(JSON.stringify(source.upstream.beat))
    expect(call.prompt).toContain(JSON.stringify(source.upstream.setting))
    expect(call.prompt).toContain('人工当前正文')
    expect(call.prompt).toContain('请放慢对话')
    expect(call.prompt).not.toContain(source.seed)
    expect(call.system).toContain('2000')
    expect(call.maxRetries).toBe(0)
    expect(call.maxOutputTokens).toBe(16000)
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
  })

  it('checks the actual assembled prompt budget, including labels and JSON escaping, before the model', async () => {
    mocks.generateObject.mockResolvedValue({ object: { text: '有效正文' }, usage: {}, finishReason: 'stop' })
    const source = await input()
    await runStep(createProseStep({ systemPrompt: '' }), source, {})
    const promptChars = mocks.generateObject.mock.calls[0]![0].prompt.length
    mocks.generateObject.mockClear()
    await runStep(createProseStep({ systemPrompt: 's'.repeat(400000 - promptChars) }), source, {})
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
    mocks.generateObject.mockClear()
    await expect(runStep(createProseStep({ systemPrompt: 's'.repeat(400001 - promptChars) }), source, {})).rejects.toMatchObject({
      code: 'input-budget-exceeded', inputBudget: { actualLength: 400001, limit: 400000 },
    })
    expect(mocks.generateObject).not.toHaveBeenCalled()
    const setting = settingContentSchema.parse(source.upstream.setting)
    setting.overview = '\u0000'.repeat(20000)
    setting.world[0]!.content = '\u0000'.repeat(20000)
    setting.characters[0]!.content = '\u0000'.repeat(20000)
    setting.factions = [{ itemId: 'faction-test', title: '测试', content: '\u0000'.repeat(20000) }]
    await expect(runStep(createProseStep(), { ...source, upstream: { ...source.upstream, setting } }, {})).rejects.toMatchObject({ code: 'input-budget-exceeded' })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })
  it.each(['length', 'invalid'])('rejects %s output instead of returning incomplete prose', async mode => {
    mocks.generateObject.mockResolvedValue({ object: mode === 'invalid' ? { text: ' ' } : { text: '截断片段' }, usage: {}, finishReason: mode === 'length' ? 'length' : 'stop' })
    await expect(runStep(createProseStep(), await input(), {})).rejects.toMatchObject({ code: 'llm-invalid-output' })
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
  })
  it('keeps provider content out of diagnostics while retaining safe context-limit classification', async () => {
    const marker = 'SYNTHETIC_PRIVATE_PROSE'
    mocks.generateObject.mockRejectedValue(Object.assign(new Error(marker), { name: 'AI_APICallError', data: { error: { code: 'context_length_exceeded', message: marker } }, text: marker }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    resetTelemetry()
    try {
      await expect(runStep(createProseStep(), await input(), {})).rejects.toMatchObject({ code: 'llm-unavailable' })
      const telemetry = telemetryFor('work-synthetic-prose')
      expect(telemetry).toMatchObject([{ stepId: 'prose', error: 'context-limit', ok: false }])
      expect(JSON.stringify(telemetry)).not.toContain(marker)
      expect(JSON.stringify(log.mock.calls)).not.toContain(marker)
    } finally { log.mockRestore() }
  })
  it('generates schema-valid fake prose from approved inputs and rewrites the current author text with instructions', async () => {
    expect(fake.createFakeProseStep).toBeDefined()
    const source = await input()
    const initial = proseContentSchema.parse((await runStep(fake.createFakeProseStep(), source, {})).content)
    expect(initial.text).toContain('初遇变局')
    const rewritten = proseContentSchema.parse((await runStep(fake.createFakeProseStep(), { ...source, regeneration: { content: { text: '作者当前页的变化' }, instructions: '放慢对话' } }, {})).content)
    expect(rewritten.text).toContain('作者当前页的变化')
    expect(rewritten.text).toContain('放慢对话')
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })
})
