import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { interviewAnswerSchema, jsonValueSchema, type JsonValue } from '@agent4novel/contracts'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import type {
  ArtifactStep,
  PipelineDefinitionEntry,
  PipelineInput,
  PipelineOutput,
} from '../src/pipeline/pipeline.js'

// 步骤输入契约（#3b 拓宽）：pipeline 组装 { workId, seed, phase?, answers? }，step 按需取用
const stepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  phase: z.enum(['questions', 'normalize']).optional(),
  answers: z.array(interviewAnswerSchema).optional(),
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

// interview 版 fake：按 phase 返回固定问题 / 固定要点 JSON，并记录收到的输入
function interviewFakeStep(id: string): { step: ArtifactStep; seen: PipelineInput[] } {
  const seen: PipelineInput[] = []
  const step: ArtifactStep = {
    id,
    inputSchema: stepInputSchema,
    outputSchema: z.object({ content: jsonValueSchema }),
    async run(input): Promise<PipelineOutput> {
      seen.push(input)
      const content: JsonValue =
        input.phase === 'questions'
          ? { questions: ['主角是谁？', '爽点是什么？'] }
          : {
              inputStage: '脑洞',
              hooks: ['卖点（fake）'],
              synopsis: ['梗概（fake）'],
              setting: [],
              outline: [],
            }
      return { content }
    },
  }
  return { step, seen }
}

const definition: PipelineDefinitionEntry[] = [
  { stepId: 'preprocess', outputKind: 'preprocess' },
  { stepId: 'outline', outputKind: 'outline', gateAfter: { kind: 'outline' } },
  { stepId: 'setting', outputKind: 'setting', gateBefore: { kind: 'outline' } },
]

function makePipeline() {
  const store = new InMemoryStore()
  const steps = new Map<string, ArtifactStep>([
    ['preprocess', fakeStep('preprocess', 'preprocess content')],
    ['outline', fakeStep('outline', 'outline content')],
    ['setting', fakeStep('setting', 'setting content')],
  ])
  const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
  return { store, pipeline }
}

const interviewDefinition: PipelineDefinitionEntry[] = [
  {
    stepId: 'preprocess',
    outputKind: 'preprocess',
    gateAfter: { kind: 'preprocess' },
    interview: true,
  },
]

function makeInterviewPipeline(interview: boolean) {
  const store = new InMemoryStore()
  const { step, seen } = interviewFakeStep('preprocess')
  const steps = new Map<string, ArtifactStep>([['preprocess', step]])
  const def: PipelineDefinitionEntry[] = [{ ...interviewDefinition[0]!, interview }]
  const pipeline = new Pipeline({ store, steps, definition: def, resolveConfig: () => ({}) })
  return { store, pipeline, seen }
}

describe('Pipeline', () => {
  it('initial state is ready at the first step', () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    const state = pipeline.getState(w.id)
    expect(state.stage).toBe('ready')
    expect(state.nextStepId).toBe('preprocess')
  })

  it('advance runs steps in order', async () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    const r1 = await pipeline.advance(w.id)
    expect(r1.stepId).toBe('preprocess')
    const r2 = await pipeline.advance(w.id)
    expect(r2.stepId).toBe('outline')
  })

  it('gateAfter blocks the next step until approved', async () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id) // preprocess
    const r2 = await pipeline.advance(w.id) // outline (gateAfter)
    expect(r2.state.stage).toBe('awaiting-approval')
    expect(r2.state.pendingGate?.kind).toBe('outline')

    // advance while gate pending: no side effect, no setting produced
    const r3 = await pipeline.advance(w.id)
    expect(r3.stepId).toBeNull()
    expect(store.getWork(w.id)!.artifacts.some((a) => a.kind === 'setting')).toBe(false)
  })

  it('approve unblocks the gated step, then pipeline completes', async () => {
    const { store, pipeline } = makePipeline()
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id) // preprocess
    await pipeline.advance(w.id) // outline (gateAfter)

    pipeline.approve(w.id, 'outline')
    const r3 = await pipeline.advance(w.id)
    expect(r3.stepId).toBe('setting')

    const r4 = await pipeline.advance(w.id)
    expect(r4.stepId).toBeNull()
    expect(r4.state.stage).toBe('complete')
    expect(r4.state.nextStepId).toBeNull()
  })

  it('rejects a step whose output does not match its schema', async () => {
    const store = new InMemoryStore()
    const badStep: ArtifactStep = {
      id: 'preprocess',
      inputSchema: stepInputSchema,
      outputSchema: z.object({ content: jsonValueSchema }),
      run: async () => ({ content: undefined }) as unknown as { content: JsonValue },
    }
    const steps = new Map<string, ArtifactStep>([
      ['preprocess', badStep],
      ['outline', fakeStep('outline', 'ok')],
      ['setting', fakeStep('setting', 'ok')],
    ])
    const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })
    const w = store.createWork({ seed: 'x' })
    await expect(pipeline.advance(w.id)).rejects.toThrow()
  })

  it('rejects duplicate step ids at construction', () => {
    const store = new InMemoryStore()
    const steps = new Map<string, ArtifactStep>([['a', fakeStep('a', 'x')]])
    const badDefinition: PipelineDefinitionEntry[] = [
      { stepId: 'a', outputKind: 'preprocess' },
      { stepId: 'a', outputKind: 'outline' },
    ]
    expect(
      () => new Pipeline({ store, steps, definition: badDefinition, resolveConfig: () => ({}) }),
    ).toThrow(/duplicate/)
  })

  it('rejects a definition referencing an unregistered step', () => {
    const store = new InMemoryStore()
    const steps = new Map<string, ArtifactStep>([['a', fakeStep('a', 'x')]])
    const def: PipelineDefinitionEntry[] = [{ stepId: 'missing', outputKind: 'preprocess' }]
    expect(() => new Pipeline({ store, steps, definition: def, resolveConfig: () => ({}) })).toThrow(
      /not registered/,
    )
  })
})

describe('Pipeline interview', () => {
  it('interview=true: advance enters awaiting-interview with questions and writes no artifact', async () => {
    const { store, pipeline } = makeInterviewPipeline(true)
    const w = store.createWork({ seed: '一个脑洞' })
    const r = await pipeline.advance(w.id)
    expect(r.stepId).toBe('preprocess')
    expect(r.state.stage).toBe('awaiting-interview')
    expect(r.state.pendingInterview?.questions).toEqual(['主角是谁？', '爽点是什么？'])
    expect(store.getWork(w.id)!.artifacts).toHaveLength(0)
  })

  it('advance is a no-op while awaiting interview', async () => {
    const { store, pipeline } = makeInterviewPipeline(true)
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id)
    const r = await pipeline.advance(w.id)
    expect(r.stepId).toBeNull()
    expect(r.state.stage).toBe('awaiting-interview')
    expect(store.getWork(w.id)!.artifacts).toHaveLength(0)
  })

  it('answerInterview normalizes, persists a pending artifact, and clears the interview', async () => {
    const { store, pipeline } = makeInterviewPipeline(true)
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id)
    const r = await pipeline.answerInterview(w.id, [{ question: '主角是谁？', answer: '林澈' }])
    expect(r.stepId).toBe('preprocess')
    expect(r.state.stage).toBe('awaiting-approval')
    expect(r.state.pendingInterview).toBeUndefined()
    const artifacts = store.getWork(w.id)!.artifacts
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.humanStatus).toBe('pending')
    expect(artifacts[0]!.content).toMatchObject({ inputStage: '脑洞', hooks: ['卖点（fake）'] })
  })

  it('answerInterview throws without a pending interview', async () => {
    const { store, pipeline } = makeInterviewPipeline(true)
    const w = store.createWork({ seed: 'x' })
    await expect(pipeline.answerInterview(w.id, [])).rejects.toThrow(/no pending interview/)
  })

  it('step receives assembled context: workId, seed from store, phase, answers', async () => {
    const { store, pipeline, seen } = makeInterviewPipeline(true)
    const w = store.createWork({ seed: '种子文本' })
    await pipeline.advance(w.id)
    expect(seen[0]).toMatchObject({ workId: w.id, seed: '种子文本', phase: 'questions' })
    await pipeline.answerInterview(w.id, [{ question: 'q', answer: 'a' }])
    expect(seen[1]).toMatchObject({
      workId: w.id,
      seed: '种子文本',
      phase: 'normalize',
      answers: [{ question: 'q', answer: 'a' }],
    })
  })

  it('interview=false: advance goes straight to normalize and persists', async () => {
    const { store, pipeline, seen } = makeInterviewPipeline(false)
    const w = store.createWork({ seed: 'x' })
    const r = await pipeline.advance(w.id)
    expect(r.state.stage).toBe('awaiting-approval')
    expect(store.getWork(w.id)!.artifacts).toHaveLength(1)
    // pipeline 不显式传 phase（缺省 normalize 是 step 自己的事）
    expect(seen[0]!.phase).toBeUndefined()
  })

  it('approve after interview completes the pipeline', async () => {
    const { store, pipeline } = makeInterviewPipeline(true)
    const w = store.createWork({ seed: 'x' })
    await pipeline.advance(w.id)
    await pipeline.answerInterview(w.id, [])
    pipeline.approve(w.id, 'preprocess')
    const state = pipeline.getState(w.id)
    expect(state.stage).toBe('complete')
  })
})
