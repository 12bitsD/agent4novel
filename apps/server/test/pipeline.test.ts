import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonValueSchema, type JsonValue } from '@agent4novel/contracts'
import { KnownError } from '../src/errors.js'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import type {
  ArtifactStep,
  PipelineDefinitionEntry,
  PipelineInput,
  PipelineOutput,
} from '../src/pipeline/pipeline.js'

// 步骤输入契约(#3c):pipeline 组装 { workId, seed, upstream },step 按需取用
const stepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  upstream: jsonValueSchema,
})

function fakeStep(id: string, content: JsonValue): ArtifactStep {
  return {
    id,
    inputSchema: stepInputSchema,
    outputSchema: z.object({ content: jsonValueSchema }),
    async run() {
      return { content }
    },
  }
}

// 记录收到的输入的 fake,用于 consumes 注入断言
function recordingStep(id: string, content: JsonValue): { step: ArtifactStep; seen: PipelineInput[] } {
  const seen: PipelineInput[] = []
  const step: ArtifactStep = {
    id,
    inputSchema: stepInputSchema,
    outputSchema: z.object({ content: jsonValueSchema }),
    async run(input): Promise<PipelineOutput> {
      seen.push(input)
      return { content }
    },
  }
  return { step, seen }
}

// caption(无关卡,自动 approved)→ creative(gateAfter)→ outline(gateAfter)
const definition: PipelineDefinitionEntry[] = [
  { stepId: 'caption', outputKind: 'caption' },
  { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
  { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
]

function makePipeline() {
  const store = new InMemoryStore()
  const creative = recordingStep('creative', { made: 'creative' })
  const outline = recordingStep('outline', { made: 'outline' })
  const steps = new Map<string, ArtifactStep>([
    ['caption', fakeStep('caption', { made: 'caption' })],
    ['creative', creative.step],
    ['outline', outline.step],
  ])
  const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
  return { store, pipeline, seen: { creative: creative.seen, outline: outline.seen } }
}

describe('Pipeline(#3c 链式 advance)', () => {
  it('does not commit output generated from an upstream replaced while the step runs', async () => {
    const store = new InMemoryStore()
    let release!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    const creative = fakeStep('creative', { made: 'creative' })
    creative.run = async () => { await paused; return { content: { made: 'stale' } } }
    const pipeline = new Pipeline({
      store,
      steps: new Map([['caption', fakeStep('caption', 'caption')], ['creative', creative]]),
      definition: definition.slice(0, 2),
      resolveConfig: () => ({}),
    })
    const work = store.createWork({ seed: 'race' })
    store.appendArtifact(work.id, 'caption', 'old caption')
    store.setStatus(work.id, 'caption', 'approved')
    const advancing = pipeline.advance(work.id)
    store.appendArtifact(work.id, 'caption', 'new caption')
    store.setStatus(work.id, 'caption', 'approved')
    release()
    expect(await advancing).toMatchObject({ kind: 'failed', code: 'upstream-changed' })
    expect(store.getWork(work.id)!.artifacts.some((a) => a.kind === 'creative')).toBe(false)
  })

  it('initial state is ready at the first step', () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    const state = pipeline.getState(w.id)
    expect(state.stage).toBe('ready')
    expect(state.nextStepId).toBe('caption')
  })

  it('advance chains auto-approved steps until the next gate', async () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    // caption 无关卡 → 链式直跑 creative(gateAfter)→ awaiting-approval
    const r = await pipeline.advance(w.id)
    expect(r.kind).toBe('advanced')
    if (r.kind === 'advanced') expect(r.stepId).toBe('creative')
    expect(r.state.stage).toBe('awaiting-approval')
    expect(r.state.pendingGate?.kind).toBe('creative')

    const artifacts = store.getWork(w.id)!.artifacts
    expect(artifacts.find((a) => a.kind === 'caption')?.humanStatus).toBe('approved')
    expect(artifacts.find((a) => a.kind === 'creative')?.humanStatus).toBe('pending')
  })

  it('consumes injects the latest approved upstream into step input', async () => {
    const { store, pipeline, seen } = makePipeline()
    const w = store.createWork({ seed: '种子文本' })
    await pipeline.advance(w.id)
    expect(seen.creative[0]).toMatchObject({
      workId: w.id,
      seed: '种子文本',
      upstream: { caption: { made: 'caption' } },
    })
  })

  it('advance is a no-op at a gate, resumes after approve, and completes', async () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id) // caption + creative(gate)

    const r2 = await pipeline.advance(w.id)
    expect(r2.kind).toBe('awaiting-approval')
    expect(store.getWork(w.id)!.artifacts.some((a) => a.kind === 'outline')).toBe(false)

    pipeline.approve(w.id, 'creative')
    const r3 = await pipeline.advance(w.id)
    expect(r3.kind).toBe('advanced')
    if (r3.kind === 'advanced') expect(r3.stepId).toBe('outline')

    pipeline.approve(w.id, 'outline')
    const r4 = await pipeline.advance(w.id)
    expect(r4.kind).toBe('complete')
    // complete 后重复调用 = no-op
    const r5 = await pipeline.advance(w.id)
    expect(r5.kind).toBe('complete')
  })

  it('creative latest pending blocks outline(consumes 读最新版且必须 approved)', async () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id)
    pipeline.approve(w.id, 'creative')
    // 人工保存草稿 → 最新版 pending → 停在该关卡,outline 不推进
    store.appendArtifact(w.id, 'creative', { made: 'draft' })
    const state = pipeline.getState(w.id)
    expect(state.stage).toBe('awaiting-approval')
    expect(state.pendingGate?.kind).toBe('creative')
    const r = await pipeline.advance(w.id)
    expect(r.kind).toBe('awaiting-approval')
    expect(store.getWork(w.id)!.artifacts.some((a) => a.kind === 'outline')).toBe(false)
  })

  it('a failing step yields outcome failed with retryable, and retry resumes from it', async () => {
    const store = new InMemoryStore()
    let fail = true
    const flaky: ArtifactStep = {
      id: 'creative',
      inputSchema: stepInputSchema,
      outputSchema: z.object({ content: jsonValueSchema }),
      async run() {
        if (fail) throw new KnownError('llm-timeout', 'boom', { retryable: true, attemptId: 'a1' })
        return { content: { made: 'creative' } }
      },
    }
    const steps = new Map<string, ArtifactStep>([
      ['caption', fakeStep('caption', { made: 'caption' })],
      ['creative', flaky],
      ['outline', fakeStep('outline', 'ok')],
    ])
    const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
    const w = store.createWork({ seed: 'x' })

    const r1 = await pipeline.advance(w.id)
    expect(r1.kind).toBe('failed')
    if (r1.kind === 'failed') {
      expect(r1.stepId).toBe('creative')
      expect(r1.code).toBe('llm-timeout')
      expect(r1.retryable).toBe(true)
      expect(r1.attemptId).toBe('a1')
    }
    // caption 已成功 → 重试只跑 creative(caption 不重跑:仍只有一份 caption 产物)
    fail = false
    const r2 = await pipeline.advance(w.id)
    expect(r2.kind).toBe('advanced')
    const captions = store.getWork(w.id)!.artifacts.filter((a) => a.kind === 'caption')
    expect(captions).toHaveLength(1)
  })

  it('concurrent advance on the same work → advance-in-progress', async () => {
    const store = new InMemoryStore()
    let release!: () => void
    const slow: ArtifactStep = {
      id: 'caption',
      inputSchema: stepInputSchema,
      outputSchema: z.object({ content: jsonValueSchema }),
      run: () => new Promise((res) => (release = () => res({ content: 'slow' }))),
    }
    const steps = new Map<string, ArtifactStep>([
      ['caption', slow],
      ['creative', fakeStep('creative', 'ok')],
      ['outline', fakeStep('outline', 'ok')],
    ])
    const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
    const w = store.createWork({ seed: 'x' })

    const p1 = pipeline.advance(w.id)
    await expect(pipeline.advance(w.id)).rejects.toMatchObject({ code: 'advance-in-progress' })
    release()
    await p1
    // 锁在 finally 中释放:之后还能正常推进
    const r = await pipeline.advance(w.id)
    expect(r.kind).not.toBe('failed')
  })

  it('rejects a step whose output does not match its schema', async () => {
    const store = new InMemoryStore()
    const badStep: ArtifactStep = {
      id: 'caption',
      inputSchema: stepInputSchema,
      outputSchema: z.object({ content: jsonValueSchema }),
      run: async () => ({ content: undefined }) as unknown as { content: JsonValue },
    }
    const steps = new Map<string, ArtifactStep>([
      ['caption', badStep],
      ['creative', fakeStep('creative', 'ok')],
      ['outline', fakeStep('outline', 'ok')],
    ])
    const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
    const w = store.createWork({ seed: 'x' })
    const r = await pipeline.advance(w.id)
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') expect(r.stepId).toBe('caption')
  })

  it('rejects duplicate step ids / outputKinds at construction', () => {
    const store = new InMemoryStore()
    const steps = new Map<string, ArtifactStep>([['a', fakeStep('a', 'x')]])
    expect(
      () =>
        new Pipeline({
          store,
          steps,
          definition: [
            { stepId: 'a', outputKind: 'caption' },
            { stepId: 'a', outputKind: 'creative' },
          ],
          resolveConfig: () => ({}),
        }),
    ).toThrow(/duplicate/)
    expect(
      () =>
        new Pipeline({
          store,
          steps: new Map([['a', fakeStep('a', 'x')], ['b', fakeStep('b', 'x')]]),
          definition: [
            { stepId: 'a', outputKind: 'caption' },
            { stepId: 'b', outputKind: 'caption' },
          ],
          resolveConfig: () => ({}),
        }),
    ).toThrow(/duplicate/)
  })

  it('rejects consumes pointing at non-prior kinds(禁自依赖与环)', () => {
    const store = new InMemoryStore()
    const steps = new Map<string, ArtifactStep>([
      ['a', fakeStep('a', 'x')],
      ['b', fakeStep('b', 'x')],
    ])
    // 前向依赖(环)
    expect(
      () =>
        new Pipeline({
          store,
          steps,
          definition: [
            { stepId: 'a', outputKind: 'caption', consumes: ['creative'] },
            { stepId: 'b', outputKind: 'creative' },
          ],
          resolveConfig: () => ({}),
        }),
    ).toThrow(/consumes/)
    // 自依赖
    expect(
      () =>
        new Pipeline({
          store,
          steps,
          definition: [
            { stepId: 'a', outputKind: 'caption', consumes: ['caption'] },
            { stepId: 'b', outputKind: 'creative' },
          ],
          resolveConfig: () => ({}),
        }),
    ).toThrow(/consumes/)
  })

  it('消费守卫:approved 但守卫不过的 creative 阻塞下游(advance → 不推进)', async () => {
    // 用共享守卫(pipeline/consume-guards.ts):creative 必须恰好 1 方向
    const { consumeGuards } = await import('../src/pipeline/consume-guards.js')
    const store = new InMemoryStore()
    const steps = new Map<string, ArtifactStep>([
      ['caption', fakeStep('caption', { made: 'caption' })],
      ['creative', fakeStep('creative', { made: 'creative' })],
      ['outline', fakeStep('outline', 'ok')],
    ])
    const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}), consumeGuards })
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id)
    // 模拟异常路径:2 方向的 creative 被标 approved(绕过了 select)
    store.appendArtifact(w.id, 'creative', {
      directions: [
        {
          directionId: 'd1', title: 'A', hook: 'h', tags: [], synopsis: 's',
          characters: [], setting: [], payoffs: [], outline: [],
        },
        {
          directionId: 'd2', title: 'B', hook: 'h', tags: [], synopsis: 's',
          characters: [], setting: [], payoffs: [], outline: [],
        },
      ],
    })
    store.setStatus(w.id, 'creative', 'approved')
    const state = pipeline.getState(w.id)
    expect(state.stage).toBe('blocked')
    expect(state.pendingGate?.kind).toBe('creative')
    const r = await pipeline.advance(w.id)
    expect(r.kind).toBe('awaiting-approval')
    expect(store.getWork(w.id)!.artifacts.some((a) => a.kind === 'outline')).toBe(false)
  })

  it('rejects a definition referencing an unregistered step', () => {
    const store = new InMemoryStore()
    const steps = new Map<string, ArtifactStep>([['a', fakeStep('a', 'x')]])
    const def: PipelineDefinitionEntry[] = [{ stepId: 'missing', outputKind: 'caption' }]
    expect(() => new Pipeline({ store, steps, definition: def, resolveConfig: () => ({}) })).toThrow(
      /not registered/,
    )
  })
})
