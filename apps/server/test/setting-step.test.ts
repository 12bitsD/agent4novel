import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runStep, settingContentSchema } from '@agent4novel/contracts'

const mocks = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../src/steps/llm.js', () => ({ modelRuntime: {
  defaultModelId: 'deepseek:deepseek-chat', requestTimeoutMs: 120_000, languageModel: () => 'mock-model',
} }))

import { createSettingStep } from '../src/steps/setting-step.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep } from '../src/steps/fake-step.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { telemetryCursor, telemetryFor } from '../src/steps/telemetry.js'

const draft = {
  overview: '旅人在迷雾小镇寻找名字。',
  world: [{ title: '街道', content: '每天重新排列。' }],
  characters: [{ title: '旅人', content: '寻找自己。' }],
  factions: [], relationships: [],
  extensions: [{ title: '记忆术语', items: [{ title: '回声', content: '**过去**留下的声音。' }] }],
}

async function input() {
  const base = { workId: 'w-setting', seed: '合成脑洞：失去名字的旅人', upstream: {} }
  const caption = (await runStep(createFakeCaptionStep(), base, {})).content
  const creative = (await runStep(createFakeCreativeStep(), { ...base, upstream: { caption } }, { directionCount: 1 })).content
  const outline = (await runStep(createFakeOutlineStep(), { ...base, upstream: { creative } }, {})).content
  return { ...base, upstream: { caption, creative, outline } }
}

beforeEach(() => { mocks.generateObject.mockReset() })

describe('Setting Step model boundary', () => {
  it.each([
    ['AI_NoObjectGeneratedError', 'llm-invalid-output'],
    ['TimeoutError', 'llm-timeout'],
  ])('propagates %s without another model attempt', async (name, code) => {
    const error = new Error('synthetic failure')
    error.name = name!
    mocks.generateObject.mockRejectedValue(error)
    await expect(runStep(createSettingStep(), await input(), {})).rejects.toMatchObject({ code, retryable: true })
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
  })

  it('provides a complete schema-valid demo Setting without calling a model', async () => {
    const result = await runStep(createFakeSettingStep(), await input(), {})
    const content = settingContentSchema.parse(result.content)
    expect(content.world.length).toBeGreaterThan(0)
    expect(content.characters.length).toBeGreaterThan(0)
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('generates one complete Setting with server IDs from all four inputs in one call', async () => {
    mocks.generateObject.mockResolvedValue({ object: draft, usage: {}, finishReason: 'stop' })
    const source = await input()
    const result = await runStep(createSettingStep(), source, {})
    const content = settingContentSchema.parse(result.content)
    expect(content.overview).toBe(draft.overview)
    expect(content.world[0]!.itemId).toMatch(/^item-/)
    expect(content.extensions[0]!.sectionId).toMatch(/^section-/)
    expect(mocks.generateObject).toHaveBeenCalledTimes(1)
    const call = mocks.generateObject.mock.calls[0]![0]
    expect(call.maxOutputTokens).toBe(16000)
    expect(call.maxRetries).toBe(0)
    expect(call.prompt).toContain(source.seed)
    expect(call.prompt).toContain('素材提炼稿')
    expect(call.prompt).toContain('选定创作方向')
    expect(call.prompt).toContain('已通过大纲')
    expect(call.system).toContain('设定')
  })

  it('retains successful model telemetry separately from a rejected stale-output commit', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    mocks.generateObject.mockImplementation(async () => {
      await blocked
      return { object: draft, usage: {}, finishReason: 'stop' }
    })
    const source = await input()
    const store = new InMemoryStore()
    const work = store.createWork({ seed: source.seed })
    for (const kind of ['caption', 'creative', 'outline'] as const) {
      store.appendArtifact(work.id, kind, source.upstream[kind])
      store.setStatus(work.id, kind, 'approved')
    }
    const pipeline = new Pipeline({
      store, resolveConfig: () => ({}),
      steps: new Map([['caption', createFakeCaptionStep()], ['creative', createFakeCreativeStep()], ['outline', createFakeOutlineStep()], ['setting', createSettingStep()]]),
      definition: [
        { stepId: 'caption', outputKind: 'caption' },
        { stepId: 'creative', outputKind: 'creative', gateAfter: { kind: 'creative' } },
        { stepId: 'outline', outputKind: 'outline', gateAfter: { kind: 'outline' } },
        { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
      ],
    })
    const cursor = telemetryCursor()
    const attempt = pipeline.advance(work.id)
    store.appendArtifact(work.id, 'outline', source.upstream.outline)
    release()
    expect(await attempt).toMatchObject({ kind: 'failed', code: 'upstream-changed' })
    expect(telemetryFor(work.id, cursor)).toMatchObject([{ stepId: 'setting', ok: true }])
    expect(store.getWork(work.id)!.artifacts.some((artifact) => artifact.kind === 'setting')).toBe(false)
  })
})
