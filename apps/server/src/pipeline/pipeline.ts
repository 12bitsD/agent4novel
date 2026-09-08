import { runStep, perChapterKinds, beatContentSchema, beatRegenerateRequestSchema } from '@agent4novel/contracts'
import type {
  AgentConfig,
  Artifact,
  ArtifactKind,
  JsonValue,
  Step,
  WorkDetail,
  AdvanceOutcome,
  PipelineState,
  GateRef,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { ArtifactPrecondition, WorkStore } from '../store/work-store.js'
import { observeBeat, BeatCommandError, beatFailureCode, type BeatExecution } from '../beat-command.js'
import type { BeatCommandObservation } from '@agent4novel/contracts'
import type { BeatRegenerateRequest } from '@agent4novel/contracts'
import { prepareBeatReview } from '../beat-review.js'
import { assertBeatIds, assignBeatIds } from '../beat-content.js'
import { safeLog } from '../safe-log.js'
export type { AdvanceOutcome, GateRef, PipelineStage, PipelineState } from '@agent4novel/contracts'

// 步骤输入(#3c):pipeline 组装上下文 { workId, seed, upstream }。
// seed 是所有步骤的固有输入(不可变即 snapshot);upstream = consumes 声明的上游产物内容,
// 保持 JsonValue(pipeline 泛型),类型精确性由各 step 的 inputSchema 在边界严格恢复。
export type PipelineInput = {
  workId: string
  seed: string
  upstream: JsonValue
  chapter?: number
  regeneration?: { content: JsonValue; instructions: string }
}
export type PipelineOutput = { content: JsonValue }
export type ArtifactStep = Step<PipelineInput, PipelineOutput>

export type PipelineDefinitionEntry = {
  stepId: string
  outputKind: ArtifactKind
  chapter?: number
  // 显式上游依赖:只能指向定义中先出现条目的 outputKind(启动校验禁自依赖与环)
  consumes?: ArtifactKind[]
  gateBefore?: GateRef
  gateAfter?: GateRef
}

export type PipelineDeps = {
  store: WorkStore
  steps: Map<string, ArtifactStep>
  definition: PipelineDefinitionEntry[]
  resolveConfig: (work: WorkDetail, stepId: string) => AgentConfig
  // 消费守卫(#3c):consumes 的上游产物除了「最新版 approved」还要过领域校验,
  // 由启动装配层按 kind 注入,pipeline 保持泛型。守卫抛错 = 该产物不算数。
  consumeGuards?: Partial<Record<ArtifactKind, (content: JsonValue) => void>>
}

export class Pipeline {
  private store: WorkStore
  private steps: Map<string, ArtifactStep>
  private definition: PipelineDefinitionEntry[]
  private resolveConfig: (work: WorkDetail, stepId: string) => AgentConfig
  private consumeGuards: Partial<Record<ArtifactKind, (content: JsonValue) => void>>
  // per-work 内存互斥锁(#3c):并发 advance → 409 advance-in-progress;真正事务/lease 归 #9
  private advancing = new Set<string>()
  // 最近一次 advance 失败(供读模型 'failed' 态);成功推进或到达关卡即清除
  private lastFailure = new Map<string, { stepId: string; code: string; retryable: boolean }>()

  constructor(deps: PipelineDeps) {
    this.store = deps.store
    this.steps = deps.steps
    this.definition = deps.definition
    this.resolveConfig = deps.resolveConfig
    this.consumeGuards = deps.consumeGuards ?? {}

    const ids = new Set(this.definition.map((d) => d.stepId))
    if (ids.size !== this.definition.length) {
      throw new Error('duplicate stepId in pipeline definition')
    }
    const kinds = new Set(this.definition.map((d) => d.outputKind))
    if (kinds.size !== this.definition.length) {
      throw new Error('duplicate outputKind in pipeline definition')
    }
    for (const [i, d] of this.definition.entries()) {
      for (const address of [{ kind: d.outputKind, chapter: d.chapter }, d.gateBefore, d.gateAfter]) {
        if (!address) continue
        if (perChapterKinds.includes(address.kind) !== (address.chapter !== undefined)
          || (address.chapter !== undefined && (!Number.isSafeInteger(address.chapter) || address.chapter <= 0))) {
          throw new Error('invalid chapter address in pipeline definition')
        }
      }
      if (d.gateAfter && (d.gateAfter.kind !== d.outputKind || d.gateAfter.chapter !== d.chapter)) {
        throw new Error('gateAfter must match output address')
      }
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
      const out = latest.get(`${entry.outputKind}:${entry.chapter ?? ''}`)
      if (!out) {
        // 上游最新版必须 approved 且过消费守卫,否则本步不可跑(下游不推进)
        if (entry.consumes) {
          for (const dep of entry.consumes) {
            const chapter = this.definition.find((d) => d.outputKind === dep)?.chapter
            const upstream = latest.get(`${dep}:${chapter ?? ''}`)
            if (!upstream || upstream.humanStatus !== 'approved' || !this.guardOk(dep, upstream)) {
              return {
                workId,
                stage: 'blocked',
                nextStepId: entry.stepId,
                pendingGate: { kind: dep, chapter },
              }
            }
          }
        }
        if (entry.gateBefore) {
          const gate = latest.get(`${entry.gateBefore.kind}:${entry.gateBefore.chapter ?? ''}`)
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
      if (!this.guardOk(entry.outputKind, out)) {
        return { workId, stage: 'blocked', nextStepId: entry.stepId, pendingGate: { kind: out.kind, chapter: out.chapter } }
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
        let beatCommand: BeatCommandObservation | undefined
        try {
          if (entry.outputKind === 'beat') {
            const result = await observeBeat(workId, 'generate-beat', null, execution => this.runEntry(workId, entry, execution))
            beatCommand = result.command
          } else await this.runEntry(workId, entry)
        } catch (err) {
          const cause = err instanceof BeatCommandError ? err.cause : err
          const known = cause instanceof KnownError ? cause : null
          const code = err instanceof BeatCommandError ? beatFailureCode(cause, err.command.failureStage ?? 'response') : known?.code ?? 'llm-unavailable'
          // 丢弃旧输入上的生成结果后可手动重试；尚未通过的上游仍由 getState 阻挡。
          const retryable = known?.code === 'upstream-changed' || (known?.retryable ?? true)
          this.lastFailure.set(workId, {
            stepId: entry.stepId,
            code,
            retryable,
          })
          return {
            kind: 'failed',
            stepId: entry.stepId,
            code,
            retryable,
            attemptId: known?.attemptId,
            state: this.getState(workId),
            beatCommand: err instanceof BeatCommandError ? err.command : undefined,
            ...(known?.inputBudget ? { inputBudget: known.inputBudget } : {}),
          }
        }
        this.lastFailure.delete(workId)
        lastStepId = entry.stepId
        if (entry.gateAfter) {
          return { kind: 'advanced', stepId: entry.stepId, state: this.getState(workId), beatCommand }
        }
      }
      // 防御:循环上界被触达说明 definition 长度内未收敛
      throw new Error('advance loop exceeded definition length')
    } finally {
      this.advancing.delete(workId)
    }
  }

  // 读模型按定义末端区分三步兼容链与四步设定链。
  async regenerateBeat(workId: string, request: BeatRegenerateRequest) {
    return observeBeat(workId, 'regenerate-beat', { artifactId: request.expectedArtifactId, version: request.expectedHeadVersion }, async execution => {
      if (this.advancing.has(workId)) throw new KnownError('advance-in-progress', 'generation already running', { retryable: true })
      this.advancing.add(workId)
      try {
        const { work, baseline, preconditions } = prepareBeatReview(this.store, workId, request)
        const state = this.getState(workId)
        if (state.stage !== 'awaiting-approval' || state.pendingGate?.kind !== 'beat' || state.pendingGate.chapter !== 1) {
          throw new KnownError('beat-gate-not-ready', 'beat gate not ready')
        }
        const entry = this.definition.find(d => d.outputKind === 'beat' && d.chapter === 1)
        if (!entry) throw new KnownError('beat-gate-not-ready', 'beat step not configured')
        execution.stage = 'input'
        const parsed = beatRegenerateRequestSchema.parse(request)
        assertBeatIds(parsed.content, baseline.content)
        const upstream = Object.fromEntries((entry.consumes ?? []).map(kind => {
          const chapter = this.definition.find(d => d.outputKind === kind)?.chapter
          return [kind, work.artifacts.find(a => a.kind === kind && a.chapter === chapter)!.content]
        }))
        const content = { ...parsed.content, writingPlan: parsed.content.writingPlan.map(({ title, content }) => ({ title, content })) }
        execution.stage = 'model'
        const output = await runStep(this.steps.get(entry.stepId)!, {
          workId, seed: work.seed, upstream, chapter: 1, regeneration: { content, instructions: parsed.instructions },
        }, this.resolveConfig(work, entry.stepId))
        execution.stage = 'output'
        const generated = beatContentSchema.parse(output.content)
        const candidate = assignBeatIds({ ...generated, writingPlan: generated.writingPlan.map(({ title, content }) => ({ title, content })) }, baseline.content)
        execution.stage = 'commit'
        return this.store.appendArtifact(workId, 'beat', candidate, { chapter: 1, preconditions: [
          ...preconditions, { kind: 'beat', chapter: 1, head: { artifactId: baseline.id, version: baseline.version, humanStatus: 'pending' } },
        ] })
      } finally { this.advancing.delete(workId) }
    })
  }

  get completionKind(): ArtifactKind | undefined {
    return this.definition.at(-1)?.outputKind
  }

  // 读模型用:最近一次失败(无 → null)。审批等人工动作也会清掉它。
  failureOf(workId: string): { stepId: string; code: string; retryable: boolean } | null {
    return this.lastFailure.get(workId) ?? null
  }

  private guardOk(kind: ArtifactKind, artifact: Artifact): boolean {
    const guard = this.consumeGuards[kind]
    if (!guard) return true
    try {
      guard(artifact.content)
      return true
    } catch {
      return false
    }
  }

  private async runEntry(workId: string, entry: PipelineDefinitionEntry, execution?: BeatExecution): Promise<Artifact> {
    const step = this.steps.get(entry.stepId)!
    const work = this.store.getWork(workId)!
    const config = this.resolveConfig(work, entry.stepId)
    const upstream: Record<string, JsonValue> = {}
    const preconditions: ArtifactPrecondition[] = [{ kind: entry.outputKind, chapter: entry.chapter, head: null }]
    for (const dep of entry.consumes ?? []) {
      const chapter = this.definition.find((d) => d.outputKind === dep)?.chapter
      const a = work.artifacts.find((x) => x.kind === dep && x.chapter === chapter)
      if (a) {
        const guard = this.consumeGuards[dep]
        if (guard) guard(a.content) // 守卫抛错(如 direction-not-selected)→ 由 advance 收敛为 failed
        upstream[dep] = a.content
        preconditions.push({
          kind: dep,
          chapter,
          head: { artifactId: a.id, version: a.version, humanStatus: 'approved' },
        })
      }
    }
    if (entry.outputKind === 'beat') {
      for (const prior of this.definition.slice(0, this.definition.indexOf(entry))) {
        const head = work.artifacts.find(a => a.kind === prior.outputKind && a.chapter === prior.chapter)
        if (!head || head.humanStatus !== 'approved' || !this.guardOk(head.kind, head)) {
          throw new KnownError('beat-gate-not-ready', 'earlier gate not ready')
        }
        if (!preconditions.some(p => p.kind === head.kind && p.chapter === head.chapter)) {
          preconditions.push({ kind: head.kind, chapter: head.chapter, head: { artifactId: head.id, version: head.version, humanStatus: 'approved' } })
        }
      }
    }
    if (execution) execution.stage = 'model'
    const output = await runStep(step, { workId, seed: work.seed, upstream, chapter: entry.chapter }, config)
    if (execution) execution.stage = 'output'
    if (entry.outputKind === 'beat' && !beatContentSchema.safeParse(output.content).success) {
      throw new KnownError('llm-invalid-output', 'invalid beat output', { retryable: true })
    }
    if (execution) execution.stage = 'commit'
    const artifact = this.store.appendArtifact(workId, entry.outputKind, output.content, { preconditions, chapter: entry.chapter })
    if (!entry.gateAfter) {
      this.store.setStatus(workId, entry.outputKind, 'approved', { chapter: entry.chapter })
    }
    // 谱系(决策 19):消费的上游版本号记运行日志,不进 artifact 字段
    const consumed = Object.fromEntries(
      (entry.consumes ?? [])
        .map((dep) => [dep, preconditions.find(condition => condition.kind === dep)?.head?.version])
        .filter(([, v]) => v !== undefined),
    )
    safeLog({
        event: 'pipeline.step',
        workId,
        stepId: entry.stepId,
        outputKind: entry.outputKind,
        chapter: entry.chapter,
        outputVersion: artifact.version,
        consumed,
        seedChars: work.seed.length,
      })
    return artifact
  }

  approve(workId: string, kind: ArtifactKind, chapter?: number): void {
    if (kind === 'beat') throw new KnownError('beat-approval-required', 'beat must use its full-content approval command')
    if (kind === 'setting') {
      throw new KnownError('setting-approval-required', 'setting must use its full-content approval command')
    }
    this.store.setStatus(workId, kind, 'approved', chapter !== undefined ? { chapter } : undefined)
    this.lastFailure.delete(workId)
  }
}
