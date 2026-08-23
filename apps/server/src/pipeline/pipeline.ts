import { runStep } from '@agent4novel/contracts'
import type { AgentConfig, Artifact, ArtifactKind, Step } from '@agent4novel/contracts'
import type { WorkStore } from '../store/work-store.js'

export type PipelineInput = { workId: string }
export type PipelineOutput = { content: string }
export type ArtifactStep = Step<PipelineInput, PipelineOutput>

export type GateRef = { kind: ArtifactKind; chapter?: number }
export type PipelineStage = 'ready' | 'blocked' | 'awaiting-approval' | 'complete'

export type PipelineState = {
  workId: string
  stage: PipelineStage
  nextStepId: string | null
  pendingGate?: GateRef
}

export type StepResult = { stepId: string | null; state: PipelineState }

export type PipelineDefinitionEntry = {
  stepId: string
  outputKind: ArtifactKind
  gateBefore?: { kind: ArtifactKind }
  gateAfter?: { kind: ArtifactKind }
}

export type PipelineDeps = {
  store: WorkStore
  steps: Map<string, ArtifactStep>
  definition: PipelineDefinitionEntry[]
  resolveConfig: (workId: string, stepId: string) => AgentConfig
}

export class Pipeline {
  private store: WorkStore
  private steps: Map<string, ArtifactStep>
  private definition: PipelineDefinitionEntry[]
  private resolveConfig: (workId: string, stepId: string) => AgentConfig

  constructor(deps: PipelineDeps) {
    this.store = deps.store
    this.steps = deps.steps
    this.definition = deps.definition
    this.resolveConfig = deps.resolveConfig

    const ids = new Set(this.definition.map((d) => d.stepId))
    if (ids.size !== this.definition.length) {
      throw new Error('duplicate stepId in pipeline definition')
    }
    for (const d of this.definition) {
      if (!this.steps.has(d.stepId)) throw new Error(`step not registered: ${d.stepId}`)
    }
  }

  getState(workId: string): PipelineState {
    const work = this.store.getWork(workId)
    if (!work) throw new Error(`work not found: ${workId}`)
    const latest = new Map<string, Artifact>()
    for (const a of work.artifacts) latest.set(`${a.kind}:${a.chapter ?? ''}`, a)

    for (const entry of this.definition) {
      const out = latest.get(`${entry.outputKind}:`)
      if (!out) {
        if (entry.gateBefore) {
          const gate = latest.get(`${entry.gateBefore.kind}:`)
          if (!gate || gate.status !== 'approved') {
            return {
              workId,
              stage: 'blocked',
              nextStepId: entry.stepId,
              pendingGate: entry.gateBefore,
            }
          }
        }
        return { workId, stage: 'ready', nextStepId: entry.stepId }
      }
      if (out.status === 'pending') {
        return {
          workId,
          stage: 'awaiting-approval',
          nextStepId: null,
          pendingGate: { kind: out.kind, chapter: out.chapter },
        }
      }
    }
    return { workId, stage: 'complete', nextStepId: null }
  }

  async advance(workId: string): Promise<StepResult> {
    const state = this.getState(workId)
    if (state.pendingGate || state.nextStepId === null) {
      return { stepId: null, state }
    }
    const entry = this.definition.find((d) => d.stepId === state.nextStepId)!
    const step = this.steps.get(entry.stepId)!
    const config = this.resolveConfig(workId, entry.stepId)
    const output = await runStep(step, { workId }, config)
    this.store.appendArtifact(workId, entry.outputKind, output.content)
    if (!entry.gateAfter) {
      this.store.setStatus(workId, entry.outputKind, 'approved')
    }
    return { stepId: entry.stepId, state: this.getState(workId) }
  }

  approve(workId: string, kind: ArtifactKind, chapter?: number): void {
    this.store.setStatus(workId, kind, 'approved', chapter !== undefined ? { chapter } : undefined)
  }
}
