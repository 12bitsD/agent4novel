import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beatContentSchema, runStep, settingContentSchema } from '@agent4novel/contracts'
const mocks = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({ modelRuntime: { defaultModelId: 'deepseek:deepseek-chat', requestTimeoutMs: 120_000, languageModel: () => 'mock-model' } }))
import { createBeatStep } from '../src/steps/beat-step.js'
import { resetTelemetry, telemetryFor } from '../src/steps/telemetry.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep } from '../src/steps/fake-step.js'

const draft = { title: '名字消失的早晨', goal: '主角选择保留线索。', writingPlan: [{ title: '面对异常', content: '先看清处境，再决定寻找证人。' }], ending: '主角迈向旧码头。' }
async function input() {
  const base = { workId: 'work-synthetic', seed: '合成素材：迷雾中寻找名字', upstream: {} }
  const caption = (await runStep(createFakeCaptionStep(), base, {})).content
  const creative = (await runStep(createFakeCreativeStep(), { ...base, upstream: { caption } }, { directionCount: 1 })).content
  const outline = (await runStep(createFakeOutlineStep(), { ...base, upstream: { creative } }, {})).content
  const setting = (await runStep(createFakeSettingStep(), { ...base, upstream: { caption, creative, outline } }, {})).content
  return { ...base, seed: 'DO_NOT_REPEAT_RAW_SEED', chapter: 1, upstream: { outline, setting } }
}
beforeEach(() => { mocks.generateObject.mockReset() })
describe('Beat model boundary', () => {
  it.each(['context_length_exceeded', 'max_context_length'])('reports %s safely without retrying the model', async code => {
    const marker = 'SYNTHETIC_PRIVATE_CONTEXT'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    resetTelemetry()
    mocks.generateObject.mockRejectedValue(Object.assign(new Error(marker), {
      name: 'AI_APICallError', data: { error: { code, message: marker } }, cause: new Error(marker),
    }))
    try {
      const source = await input()
      await expect(runStep(createBeatStep(), source, {})).rejects.toMatchObject({ code: 'llm-unavailable', message: 'llm request unavailable' })
      expect(mocks.generateObject).toHaveBeenCalledTimes(1)
      expect(mocks.generateObject.mock.calls[0]![0].maxRetries).toBe(0)
      expect(telemetryFor(source.workId)).toMatchObject([{ stepId: 'beat', ok: false, error: 'context-limit' }])
      expect(JSON.stringify(telemetryFor(source.workId))).not.toContain(marker)
      expect(JSON.stringify(log.mock.calls)).not.toContain(marker)
    } finally { log.mockRestore() }
  })
  it('uses complete approved inputs and current edited content without card IDs or automatic retry', async () => {
    mocks.generateObject.mockResolvedValue({ object: draft, usage: {}, finishReason: 'stop' })
    const source = await input()
    const regeneration = { content: { ...draft, goal: '作者要改变的目标', writingPlan: [] }, instructions: '合成意见：围绕对话展开' }
    const result = beatContentSchema.parse((await runStep(createBeatStep(), { ...source, regeneration }, {})).content)
    expect(result.goal).toBe(draft.goal)
    expect(result.writingPlan[0]!.itemId).toMatch(/^beat-item-[0-9a-f-]{36}$/)
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
    const call = mocks.generateObject.mock.calls[0]![0]
    expect(call.maxRetries).toBe(0)
    expect(call.prompt).toContain(JSON.stringify(source.upstream.outline))
    expect(call.prompt).toContain(JSON.stringify(source.upstream.setting))
    expect(call.prompt).toContain('作者要改变的目标')
    expect(call.prompt).toContain(regeneration.instructions)
    expect(call.prompt).not.toContain(source.seed)
    expect(call.system).toContain('首弧')
  })
  it('rejects an oversized assembled context before invoking the model and never truncates it', async () => {
    const source = await input()
    const setting = settingContentSchema.parse(source.upstream.setting)
    setting.world[0]!.content = '\u0000'.repeat(20_000)
    setting.characters[0]!.content = '\u0000'.repeat(20_000)
    setting.overview = '\u0000'.repeat(20_000)
    setting.factions = [{ itemId: 'faction-test', title: '合成组织', content: '\u0000'.repeat(20_000) }]
    await expect(runStep(createBeatStep(), { ...source, upstream: { ...source.upstream, setting } }, {})).rejects.toMatchObject({ code: 'input-budget-exceeded' })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })
})
