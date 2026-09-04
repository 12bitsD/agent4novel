import { describe, expect, it } from 'vitest'
import { settingContentSchema } from '@agent4novel/contracts'
import { Pipeline, type ArtifactStep, type PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'
import { consumeGuards } from '../src/pipeline/consume-guards.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep } from '../src/steps/fake-step.js'
import { KnownError } from '../src/errors.js'
import { approveSetting } from '../src/setting-review.js'
import { createApp } from '../src/app.js'
import { fakeArtifactStep } from './fakes.js'

const definition: PipelineDefinitionEntry[] = [
  { stepId: 'caption', outputKind: 'caption' },
  { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
  { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
  { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
]

async function ready(settingStep = createFakeSettingStep()) {
  const store = new InMemoryStore()
  const steps = new Map<string, ArtifactStep>([
    ['caption', createFakeCaptionStep()], ['creative', createFakeCreativeStep()],
    ['outline', createFakeOutlineStep()], ['setting', settingStep],
  ])
  const pipeline = new Pipeline({ store, steps, definition, consumeGuards, resolveConfig: () => ({ directionCount: 1 }) })
  const work = store.createWork({ seed: '合成脑洞：雾中小镇寻找名字' })
  await pipeline.advance(work.id)
  pipeline.approve(work.id, 'creative')
  await pipeline.advance(work.id)
  pipeline.approve(work.id, 'outline')
  return { store, steps, pipeline, work, app: createApp({ store, pipeline, meta: { demo: true } }) }
}

describe('Setting Pipeline integration', () => {
  it('offers a manual Setting retry after an upstream change was already approved', async () => {
    let release!: () => void
    let entered!: () => void
    const suspended = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const base = createFakeSettingStep()
    const step: ArtifactStep = {
      ...base,
      async run(input, config) {
        entered()
        await suspended
        return base.run(input, config)
      },
    }
    const { store, work, app } = await ready(step)
    const firstRequest = app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    await started
    const outline = store.getWork(work.id)!.artifacts.find((artifact) => artifact.kind === 'outline')!
    store.appendArtifact(work.id, 'outline', outline.content)
    store.setStatus(work.id, 'outline', 'approved')
    release()

    const firstResponse = await firstRequest
    expect(firstResponse.status).toBe(200)
    const failed = await firstResponse.json()
    expect(failed).toMatchObject({ kind: 'failed', code: 'upstream-changed', stepId: 'setting' })
    const view = await app.request(`/api/works/${work.id}`)
    expect(await view.json()).toMatchObject({
      workflowState: 'failed', nextStepId: 'setting', allowedActions: ['generate'],
    })
    expect(failed).toMatchObject({ retryable: true })

    const retry = await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    expect(await retry.json()).toMatchObject({ kind: 'advanced', stepId: 'setting' })
    expect(await (await app.request(`/api/works/${work.id}`)).json()).toMatchObject({
      workflowState: 'awaiting-setting-review', allowedActions: ['approve'],
    })
  })

  it('still blocks retry at the earlier pending gate after discarding a stale Setting', async () => {
    let release!: () => void
    let entered!: () => void
    const suspended = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const base = createFakeSettingStep()
    const step: ArtifactStep = {
      ...base,
      async run(input, config) {
        entered()
        await suspended
        return base.run(input, config)
      },
    }
    const { store, work, app } = await ready(step)
    const firstRequest = app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    await started
    const outline = store.getWork(work.id)!.artifacts.find((artifact) => artifact.kind === 'outline')!
    store.appendArtifact(work.id, 'outline', outline.content)
    release()

    expect(await (await firstRequest).json()).toMatchObject({
      kind: 'failed', code: 'upstream-changed', retryable: true,
    })
    expect(await (await app.request(`/api/works/${work.id}`)).json()).toMatchObject({
      workflowState: 'awaiting-outline-review', nextStepId: null, allowedActions: ['save-draft', 'approve'],
    })
    const blocked = await app.request(`/api/works/${work.id}/advance`, { method: 'POST' })
    expect(await blocked.json()).toMatchObject({
      kind: 'awaiting-approval', state: { pendingGate: { kind: 'outline' } },
    })
    expect(store.getWork(work.id)!.artifacts.some((artifact) => artifact.kind === 'setting')).toBe(false)
  })

  it('offers Setting after Outline and downstream consumes only the author-approved content', async () => {
    const { store, pipeline, work, app, steps } = await ready()
    expect(await (await app.request(`/api/works/${work.id}`)).json()).toMatchObject({
      workflowState: 'ready-to-generate', nextStepId: 'setting', allowedActions: ['generate'],
    })
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'advanced', stepId: 'setting' })
    const pending = store.getWork(work.id)!.artifacts.find((artifact) => artifact.kind === 'setting')!
    const content = settingContentSchema.parse(pending.content)
    const consumer = fakeArtifactStep('future-consumer', 'consumed')
    const withConsumer = new Pipeline({
      store, steps: new Map([...steps, ['future-consumer', consumer.step]]),
      definition: [...definition, { stepId: 'future-consumer', outputKind: 'prose', consumes: ['setting'], gateAfter: { kind: 'prose' } }],
      resolveConfig: () => ({}),
    })
    expect((await withConsumer.advance(work.id)).kind).toBe('awaiting-approval')
    expect(consumer.seen).toHaveLength(0)
    approveSetting(store, work.id, { content: { ...content, overview: '作者修改后唯一基准' }, expectedHeadVersion: 1 })
    await withConsumer.advance(work.id)
    expect(consumer.seen[0]).toMatchObject({ upstream: { setting: { overview: '作者修改后唯一基准' } } })
  })

  it.each(['caption', 'creative', 'outline'] as const)('does not publish a Setting if %s was replaced and reapproved during generation', async (kind) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const base = createFakeSettingStep()
    const step: ArtifactStep = { ...base, async run(input, config) { await gate; return base.run(input, config) } }
    const { store, pipeline, work } = await ready(step)
    const snapshot = store.getWork(work.id)!
    const pending = pipeline.advance(work.id)
    store.appendArtifact(work.id, kind, snapshot.artifacts.find((artifact) => artifact.kind === kind)!.content)
    store.setStatus(work.id, kind, 'approved')
    release()
    expect(await pending).toMatchObject({ kind: 'failed', code: 'upstream-changed' })
    expect(store.getWork(work.id)!.artifacts.some((artifact) => artifact.kind === 'setting')).toBe(false)
  })

  it.each(['llm-timeout', 'llm-invalid-output'] as const)('preserves approved upstream after %s and only retries the whole Setting', async (code) => {
    let fail = true
    const base = createFakeSettingStep()
    const step: ArtifactStep = { ...base, async run(input, config) {
      if (fail) throw new KnownError(code, 'synthetic model failure', { retryable: true, attemptId: 'setting-test' })
      return base.run(input, config)
    } }
    const { store, pipeline, work, app } = await ready(step)
    const before = store.getWork(work.id)!.artifacts
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'failed', code })
    expect(store.getWork(work.id)!.artifacts).toEqual(before)
    expect(await (await app.request(`/api/works/${work.id}`)).json()).toMatchObject({ workflowState: 'failed', nextStepId: 'setting', allowedActions: ['generate'] })
    fail = false
    expect(await pipeline.advance(work.id)).toMatchObject({ kind: 'advanced', stepId: 'setting' })
    expect(store.getWork(work.id)!.artifacts.filter((artifact) => artifact.kind !== 'setting')).toEqual(before)
  })
})
