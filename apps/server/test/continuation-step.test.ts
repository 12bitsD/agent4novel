import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beatContentSchema, runStep } from '@agent4novel/contracts'
import * as fake from '../src/steps/fake-step.js'
import { createBeatStep } from '../src/steps/beat-step.js'
import { createProseStep } from '../src/steps/prose-step.js'
import { runIsolatedStep } from '../src/steps/isolated-runner.js'
import { resetTelemetry, telemetryFor } from '../src/steps/telemetry.js'

const mocks = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({ modelRuntime: { mode: 'live', defaultModelId: 'kimi:kimi-k2.8-highspeed', requestTimeoutMs: 120_000, generationSettings: () => ({ parameters: {}, options: {} }), languageModel: () => 'mock-model' } }))

async function source() {
  const base = { workId: 'work-continuation', seed: '合成素材', upstream: {} }
  const caption = (await runStep(fake.createFakeCaptionStep(), base, {})).content
  const creative = (await runStep(fake.createFakeCreativeStep(), { ...base, upstream: { caption } }, { directionCount: 1 })).content
  const outline = (await runStep(fake.createFakeOutlineStep(), { ...base, upstream: { creative } }, {})).content
  const setting = (await runStep(fake.createFakeSettingStep(), { ...base, upstream: { caption, creative, outline } }, {})).content
  const beat = (await runStep(fake.createFakeBeatStep(), { ...base, chapter: 1, upstream: { outline, setting } }, {})).content
  const previousChapter = { chapter: 1, beat, prose: { text: '  作者最终正文：证人已安全离开；主角留在桥边。\n\n实际发生的事实。\n' } }
  return { base, outline, setting, beat, previousChapter }
}

beforeEach(() => { mocks.generateObject.mockReset(); resetTelemetry() })

describe('chapter continuation step boundary', () => {
  it.each(['beat', 'prose'] as const)('passes the complete previous chapter and current %s context to the model and telemetry', async stepId => {
    const data = await source()
    const output = stepId === 'beat' ? { ...beatContentSchema.parse(data.beat), writingPlan: [{ title: '追随线索', content: '从桥边继续行动。' }] } : { text: '第二章完整正文。' }
    mocks.generateObject.mockResolvedValue({ object: output, usage: {}, finishReason: 'stop' })
    const upstream = { ...(stepId === 'beat' ? { outline: data.outline } : { beat: data.beat }), setting: data.setting, previousChapter: data.previousChapter }
    const result = await runIsolatedStep({ stepId, input: { seed: data.base.seed, chapter: 2, upstream } })
    expect(result.kind).toBe('succeeded')
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
    const call = mocks.generateObject.mock.calls[0]![0]
    expect(call.prompt).toContain(JSON.stringify(data.previousChapter))
    expect(call.prompt).toContain(JSON.stringify(data.setting))
    expect(call.prompt).toContain(JSON.stringify(stepId === 'beat' ? data.outline : data.beat))
    expect(call.prompt).toContain('当前章号：2')
    expect(result.telemetry).toMatchObject([{ stepId, chapter: 2, ok: true }])
  })

  it.each(['beat', 'prose'] as const)('rejects missing, wrong, extra or unsafe %s chapter input before the model', async stepId => {
    const data = await source()
    const upstream = { ...(stepId === 'beat' ? { outline: data.outline } : { beat: data.beat }), setting: data.setting }
    const step = stepId === 'beat' ? createBeatStep() : createProseStep()
    for (const invalid of [
      { chapter: 2, upstream },
      { chapter: 1, upstream: { ...upstream, previousChapter: data.previousChapter } },
      { chapter: 3, upstream: { ...upstream, previousChapter: data.previousChapter } },
      { chapter: 2, upstream: { ...upstream, previousChapter: { ...data.previousChapter, extra: 'ignored?' } } },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(chapter => ({ chapter, upstream })),
    ]) await expect(runStep(step, { ...data.base, ...invalid }, {})).rejects.toThrow()
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it.each(['beat', 'prose'] as const)('includes previous text in the %s assembled budget and rejects rather than truncating', async stepId => {
    const data = await source()
    const input = { ...data.base, chapter: 2, upstream: { ...(stepId === 'beat' ? { outline: data.outline } : { beat: data.beat }), setting: data.setting, previousChapter: data.previousChapter } }
    const makeStep = stepId === 'beat' ? createBeatStep : createProseStep
    mocks.generateObject.mockResolvedValue({ object: stepId === 'beat' ? { ...beatContentSchema.parse(data.beat), writingPlan: [{ title: '推进', content: '继续' }] } : { text: '正文' }, usage: {}, finishReason: 'stop' })
    await runStep(makeStep({ systemPrompt: '' }), input, {})
    const promptChars = mocks.generateObject.mock.calls[0]![0].prompt.length
    mocks.generateObject.mockClear()
    await expect(runStep(makeStep({ systemPrompt: 's'.repeat(400001 - promptChars) }), input, {})).rejects.toMatchObject({
      code: 'input-budget-exceeded', inputBudget: { actualLength: 400001, previousChapterChars: JSON.stringify(data.previousChapter).length },
    })
    expect(mocks.generateObject).not.toHaveBeenCalled()
    expect(telemetryFor(data.base.workId)).toHaveLength(1)
  })

  it('fake chapter two preserves the latest previous text through both model seams', async () => {
    const data = await source()
    const beat = (await runStep(fake.createFakeBeatStep(), { ...data.base, chapter: 2, upstream: { outline: data.outline, setting: data.setting, previousChapter: data.previousChapter } }, {})).content
    expect(JSON.stringify(beat)).toContain(`已通过正文（${data.previousChapter.prose.text.length} 字）`)
    const prose = (await runStep(fake.createFakeProseStep(), { ...data.base, chapter: 2, upstream: { beat, setting: data.setting, previousChapter: data.previousChapter } }, {})).content
    expect(JSON.stringify(prose)).toContain(`最终正文（${data.previousChapter.prose.text.length} 字）`)
  })
})
