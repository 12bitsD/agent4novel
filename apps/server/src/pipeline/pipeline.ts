import { interviewQuestionsSchema, runStep } from '@agent4novel/contracts'
import type {
  AgentConfig,
  Artifact,
  ArtifactKind,
  InterviewAnswer,
  JsonValue,
  Step,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { WorkStore } from '../store/work-store.js'

// 步骤输入（#3b 拓宽）：pipeline 组装上下文 { workId, seed, phase?, answers? }。
// phase 缺省 = 'normalize'（由 step 自己的 inputSchema 兜底），pipeline 只在 interview 流程显式传。
export type PipelineInput = {
  workId: string
  seed: string
  phase?: 'questions' | 'normalize'
  answers?: InterviewAnswer[]
}
export type PipelineOutput = { content: JsonValue }
export type ArtifactStep = Step<PipelineInput, PipelineOutput>

export type GateRef = { kind: ArtifactKind; chapter?: number }
export type PipelineStage =
  | 'ready'
  | 'blocked'
  | 'awaiting-approval'
  | 'awaiting-interview'
  | 'complete'

export type PipelineState = {
  workId: string
  stage: PipelineStage
  nextStepId: string | null
  pendingGate?: GateRef
  pendingInterview?: { questions: string[] }
}

export type StepResult = { stepId: string | null; state: PipelineState }

export type PipelineDefinitionEntry = {
  stepId: string
  outputKind: ArtifactKind
  gateBefore?: { kind: ArtifactKind }
  gateAfter?: { kind: ArtifactKind }
  interview?: boolean
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
  // interview 问答态是瞬态（重启丢失，#9 随 SQLite 持久化）；产物不丢
  private pendingInterviews = new Map<string, { stepId: string; questions: string[] }>()

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
    if (!work) throw new KnownError('work-not-found', `work not found: ${workId}`)

    const pendingInterview = this.pendingInterviews.get(workId)
    if (pendingInterview) {
      return {
        workId,
        stage: 'awaiting-interview',
        nextStepId: null,
        pendingInterview: { questions: pendingInterview.questions },
      }
    }

    const latest = new Map<string, Artifact>()
    for (const a of work.artifacts) latest.set(`${a.kind}:${a.chapter ?? ''}`, a)

    for (const entry of this.definition) {
      const out = latest.get(`${entry.outputKind}:`)
      if (!out) {
        if (entry.gateBefore) {
          const gate = latest.get(`${entry.gateBefore.kind}:`)
          if (!gate || gate.humanStatus !== 'approved') {
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
      if (out.humanStatus === 'pending') {
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
    const seed = this.store.getWork(workId)!.seed

    if (entry.interview) {
      // 问题阶段：不进产物，进 pendingInterview 瞬态
      const output = await runStep(step, { workId, seed, phase: 'questions' }, config)
      const { questions } = interviewQuestionsSchema.parse(output.content)
      this.pendingInterviews.set(workId, { stepId: entry.stepId, questions })
      return { stepId: entry.stepId, state: this.getState(workId) }
    }

    const output = await runStep(step, { workId, seed }, config)
    this.store.appendArtifact(workId, entry.outputKind, output.content)
    if (!entry.gateAfter) {
      this.store.setStatus(workId, entry.outputKind, 'approved')
    }
    return { stepId: entry.stepId, state: this.getState(workId) }
  }

  async answerInterview(workId: string, answers: InterviewAnswer[]): Promise<StepResult> {
    const pending = this.pendingInterviews.get(workId)
    if (!pending) throw new KnownError('no-pending-interview', `no pending interview: ${workId}`)
    const entry = this.definition.find((d) => d.stepId === pending.stepId)!
    const step = this.steps.get(entry.stepId)!
    const work = this.store.getWork(workId)
    if (!work) throw new KnownError('work-not-found', `work not found: ${workId}`)
    const config = this.resolveConfig(workId, entry.stepId)

    const output = await runStep(
      step,
      { workId, seed: work.seed, phase: 'normalize', answers },
      config,
    )
    this.store.appendArtifact(workId, entry.outputKind, output.content)
    this.pendingInterviews.delete(workId)
    if (!entry.gateAfter) {
      this.store.setStatus(workId, entry.outputKind, 'approved')
    }
    return { stepId: entry.stepId, state: this.getState(workId) }
  }

  approve(workId: string, kind: ArtifactKind, chapter?: number): void {
    this.store.setStatus(workId, kind, 'approved', chapter !== undefined ? { chapter } : undefined)
  }
}
