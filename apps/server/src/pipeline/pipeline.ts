import { runStep } from '@agent4novel/contracts'
import type {
  AgentConfig,
  Artifact,
  ArtifactKind,
  JsonValue,
  Step,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { WorkStore } from '../store/work-store.js'

// 步骤输入(#3c):pipeline 组装上下文 { workId, seed, upstream }。
// seed 是所有步骤的固有输入(不可变即 snapshot);upstream = consumes 声明的上游产物内容,
// 保持 JsonValue(pipeline 泛型),类型精确性由各 step 的 inputSchema 在边界严格恢复。
export type PipelineInput = {
  workId: string
  seed: string
  upstream: JsonValue
}
export type PipelineOutput = { content: JsonValue }
export type ArtifactStep = Step<PipelineInput, PipelineOutput>

export type GateRef = { kind: ArtifactKind; chapter?: number }
export type PipelineStage = 'ready' | 'blocked' | 'awaiting-approval' | 'complete'

export type PipelineState = {
  workId: string
  stage: PipelineStage
  nextStepId: string | null
  pendingGate?: GateRef
}

// advance 的可穷举结果(#3c):推进到下一个关卡为止;failed 带 stepId/code/retryable 供 web 重试
export type AdvanceOutcome =
  | { kind: 'advanced'; stepId: string; state: PipelineState }
  | { kind: 'awaiting-approval'; state: PipelineState }
  | { kind: 'complete'; state: PipelineState }
  | {
      kind: 'failed'
      stepId: string
      code: string
      retryable: boolean
      attemptId?: string
      state: PipelineState
    }

export type PipelineDefinitionEntry = {
  stepId: string
  outputKind: ArtifactKind
  // 显式上游依赖:只能指向定义中先出现条目的 outputKind(启动校验禁自依赖与环)
  consumes?: ArtifactKind[]
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
  // per-work 内存互斥锁(#3c):并发 advance → 409 advance-in-progress;真正事务/lease 归 #9
  private advancing = new Set<string>()

  constructor(deps: PipelineDeps) {
    this.store = deps.store
    this.steps = deps.steps
    this.definition = deps.definition
    this.resolveConfig = deps.resolveConfig

    const ids = new Set(this.definition.map((d) => d.stepId))
    if (ids.size !== this.definition.length) {
      throw new Error('duplicate stepId in pipeline definition')
    }
    const kinds = new Set(this.definition.map((d) => d.outputKind))
    if (kinds.size !== this.definition.length) {
      throw new Error('duplicate outputKind in pipeline definition')
    }
    for (const [i, d] of this.definition.entries()) {
      if (!this.steps.has(d.stepId)) throw new Error(`step not registered: ${d.stepId}`)
      const prior = new Set(this.definition.slice(0, i).map((p) => p.outputKind))
      for (const dep of d.consumes ?? []) {
        if (!prior.has(dep)) {
          throw new Error(
            `invalid consumes: "${d.stepId}" consumes "${dep}" (must be a prior outputKind)`,
          )
        }
      }
    }
  }

  getState(workId: string): PipelineState {
    const work = this.store.getWork(workId)
    if (!work) throw new KnownError('work-not-found', `work not found: ${workId}`)

    const latest = new Map<string, Artifact>()
    for (const a of work.artifacts) latest.set(`${a.kind}:${a.chapter ?? ''}`, a)

    for (const entry of this.definition) {
      const out = latest.get(`${entry.outputKind}:`)
      if (!out) {
        // 上游最新版不是 approved → 本步不可跑(下游不推进)
        if (entry.consumes) {
          for (const dep of entry.consumes) {
            const upstream = latest.get(`${dep}:`)
            if (!upstream || upstream.humanStatus !== 'approved') {
              return {
                workId,
                stage: 'blocked',
                nextStepId: entry.stepId,
                pendingGate: { kind: dep },
              }
            }
          }
        }
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

  // advance = 推进到下一个关卡(链式:auto-approved 步骤连续跑,循环上限 = definition 长度)
  async advance(workId: string): Promise<AdvanceOutcome> {
    if (this.advancing.has(workId)) {
      throw new KnownError('advance-in-progress', `advance already running: ${workId}`, {
        retryable: true,
      })
    }
    this.advancing.add(workId)
    try {
      let lastStepId: string | null = null
      // 上限 +1:最后一次 getState 不落库也要能返回终态
      for (let i = 0; i <= this.definition.length; i++) {
        const state = this.getState(workId)
        if (state.stage === 'complete') return { kind: 'complete', state }
        if (state.stage !== 'ready' || state.nextStepId === null) {
          // blocked / awaiting-approval 都是「等人」:kind 统一为 awaiting-approval,细分看 state.stage
          return lastStepId
            ? { kind: 'advanced', stepId: lastStepId, state }
            : { kind: 'awaiting-approval', state }
        }
        const entry = this.definition.find((d) => d.stepId === state.nextStepId)!
        try {
          await this.runEntry(workId, entry)
        } catch (err) {
          const known = err instanceof KnownError ? err : null
          return {
            kind: 'failed',
            stepId: entry.stepId,
            code: known?.code ?? 'llm-unavailable',
            retryable: known?.retryable ?? true,
            attemptId: known?.attemptId,
            state: this.getState(workId),
          }
        }
        lastStepId = entry.stepId
        if (entry.gateAfter) {
          return { kind: 'advanced', stepId: entry.stepId, state: this.getState(workId) }
        }
      }
      // 防御:循环上界被触达说明 definition 长度内未收敛
      throw new Error('advance loop exceeded definition length')
    } finally {
      this.advancing.delete(workId)
    }
  }

  private async runEntry(workId: string, entry: PipelineDefinitionEntry): Promise<void> {
    const step = this.steps.get(entry.stepId)!
    const config = this.resolveConfig(workId, entry.stepId)
    const work = this.store.getWork(workId)!
    const upstream: Record<string, JsonValue> = {}
    for (const dep of entry.consumes ?? []) {
      const a = work.artifacts.find((x) => x.kind === dep)
      if (a) upstream[dep] = a.content
    }
    const output = await runStep(step, { workId, seed: work.seed, upstream }, config)
    this.store.appendArtifact(workId, entry.outputKind, output.content)
    if (!entry.gateAfter) {
      this.store.setStatus(workId, entry.outputKind, 'approved')
    }
  }

  approve(workId: string, kind: ArtifactKind, chapter?: number): void {
    this.store.setStatus(workId, kind, 'approved', chapter !== undefined ? { chapter } : undefined)
  }
}
