import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonValueSchema, type JsonValue } from '@agent4novel/contracts'
import { InMemoryStore } from '../src/store/in-memory-store.js'
import { Pipeline } from '../src/pipeline/pipeline.js'
import type { ArtifactStep, PipelineDefinitionEntry } from '../src/pipeline/pipeline.js'

function fakeStep(id: string, content: string): ArtifactStep {
  return {
    id,
    inputSchema: z.object({ workId: z.string() }),
    outputSchema: z.object({ content: jsonValueSchema }),
    async run() {
      return { content }
    },
  }
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
      inputSchema: z.object({ workId: z.string() }),
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
