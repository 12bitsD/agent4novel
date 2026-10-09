import { runStep, perChapterKinds, beatContentSchema, beatRegenerateRequestSchema, proseContentSchema, proseRegenerateRequestSchema, creativeContentSchema, creativeRegenerateRequestSchema, startChapterRequestSchema, outlineApprovalRequestSchema, outlineApprovalResponseSchema } from '@agent4novel/contracts'
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
  StartChapterRequest,
  ArtifactInput,
  OutlineApprovalRequest,
  OutlineApprovalResponse,
  CreativeRegenerateRequest,
} from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { ArtifactPrecondition, WorkStore } from '../store/work-store.js'
import { observeBeat, BeatCommandError, beatFailureCode, beatResponseError, type BeatExecution } from '../beat-command.js'
import { observeProse, ProseCommandError, proseFailureCode, proseResponseError } from '../prose-command.js'
import type { BeatCommandObservation, ProseExecutionObservation } from '@agent4novel/contracts'
import type { BeatRegenerateRequest, ProseRegenerateRequest } from '@agent4novel/contracts'
import { prepareBeatReview } from '../beat-review.js'
import { prepareProseReview } from '../prose-review.js'
import { assertBeatIds, assignBeatIds } from '../beat-content.js'
import { safeLog } from '../safe-log.js'
import { currentChapterOf } from '../chapter-view.js'
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
  repeatChapters?: boolean
  store: WorkStore
  steps: Map<string, ArtifactStep>
  definition: PipelineDefinitionEntry[]
  resolveConfig: (work: WorkDetail, stepId: string) => AgentConfig
  snapshotConfig?: (work: WorkDetail) => Record<string, AgentConfig>
  // 消费守卫(#3c):consumes 的上游产物除了「最新版 approved」还要过领域校验,
  // 由启动装配层按 kind 注入,pipeline 保持泛型。守卫抛错 = 该产物不算数。
  consumeGuards?: Partial<Record<ArtifactKind, (content: JsonValue) => void>>
}

export class Pipeline {
  readonly repeatChapters: boolean
  private store: WorkStore
  private steps: Map<string, ArtifactStep>
  private definition: PipelineDefinitionEntry[]
  private resolveConfig: (work: WorkDetail, stepId: string) => AgentConfig
  private snapshotConfig?: PipelineDeps['snapshotConfig']
  private consumeGuards: Partial<Record<ArtifactKind, (content: JsonValue) => void>>
  // per-work 内存互斥锁(#3c):并发 advance → 409 advance-in-progress;真正事务/lease 归 #9
  private advancing = new Set<string>()
  // 最近一次 advance 失败(供读模型 'failed' 态);成功推进或到达关卡即清除
  private lastFailure = new Map<string, { stepId: string; code: string; retryable: boolean }>()

  constructor(deps: PipelineDeps) {
    this.repeatChapters = deps.repeatChapters ?? false
    this.store = deps.store
    this.steps = deps.steps
    this.definition = deps.definition
    this.resolveConfig = deps.resolveConfig
    this.snapshotConfig = deps.snapshotConfig
    this.consumeGuards = deps.consumeGuards ?? {}

    if (this.repeatChapters && (this.definition.at(-2)?.outputKind !== 'beat' || this.definition.at(-1)?.outputKind !== 'prose'
      || this.definition.at(-2)?.chapter !== 1 || this.definition.at(-1)?.chapter !== 1)) {
      throw new Error('chapter repetition requires the beat#1 / prose#1 template')
    }
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

  private definitionFor(chapter: number): PipelineDefinitionEntry[] {
    if (!this.repeatChapters) return this.definition
    return this.definition.map(entry => !perChapterKinds.includes(entry.outputKind) ? entry : {
      ...entry, chapter,
      ...(entry.gateAfter ? { gateAfter: { ...entry.gateAfter, chapter } } : {}),
      ...(entry.gateBefore && perChapterKinds.includes(entry.gateBefore.kind) ? { gateBefore: { ...entry.gateBefore, chapter } } : {}),
    })
  }

  private dependencyChapter(entry: PipelineDefinitionEntry, kind: ArtifactKind): number | undefined {
    return this.repeatChapters && perChapterKinds.includes(kind) ? entry.chapter : this.definition.find(d => d.outputKind === kind)?.chapter
  }

  private previousChapter(work: WorkDetail, chapter: number): Artifact[] {
    if (!this.repeatChapters || chapter <= 1) return []
    return (['beat', 'prose'] as const).map(kind => {
      const artifact = work.artifacts.find(a => a.kind === kind && a.chapter === chapter - 1)
      if (!artifact || artifact.humanStatus !== 'approved' || !this.guardOk(kind, artifact)) {
        throw new KnownError('chapter-not-ready', 'previous chapter must be approved')
      }
      return artifact
    })
  }

  private inputsFor(work: WorkDetail, entry: PipelineDefinitionEntry) {
    const upstream: Record<string, JsonValue> = {}
    const sources: Artifact[] = []
    for (const kind of entry.consumes ?? []) {
      const chapter = this.dependencyChapter(entry, kind)
      const artifact = work.artifacts.find(a => a.kind === kind && a.chapter === chapter)
      if (!artifact || artifact.humanStatus !== 'approved') throw new KnownError('upstream-changed', 'input is no longer approved')
      this.consumeGuards[kind]?.(artifact.content)
      sources.push(artifact)
      upstream[kind] = artifact.content
    }
    const previous = this.previousChapter(work, entry.chapter ?? 1)
    if (previous.length) {
      upstream.previousChapter = { chapter: entry.chapter! - 1, beat: previous[0]!.content, prose: previous[1]!.content }
      sources.push(...previous)
    }
    const inputs: ArtifactInput[] = sources.map(a => ({ kind: a.kind, chapter: a.chapter, artifactId: a.id, version: a.version }))
    const preconditions: ArtifactPrecondition[] = sources.map(a => ({ kind: a.kind, chapter: a.chapter, head: { artifactId: a.id, version: a.version, humanStatus: 'approved' } }))
    return { upstream, inputs, preconditions }
  }

  getState(workId: string): PipelineState {
    const work = this.store.getWork(workId)
    if (!work) throw new KnownError('work-not-found', `work not found: ${workId}`)

    const latest = new Map<string, Artifact>()
    for (const a of work.artifacts) latest.set(`${a.kind}:${a.chapter ?? ''}`, a)

    for (const entry of this.definitionFor(currentChapterOf(work))) {
      const out = latest.get(`${entry.outputKind}:${entry.chapter ?? ''}`)
      if (!out) {
        if (this.repeatChapters && entry.chapter && entry.chapter > 1) {
          for (const kind of ['beat', 'prose'] as const) {
            const previous = latest.get(`${kind}:${entry.chapter - 1}`)
            if (!previous || previous.humanStatus !== 'approved' || !this.guardOk(kind, previous)) {
              return { workId, stage: 'blocked', nextStepId: entry.stepId, pendingGate: { kind, chapter: entry.chapter - 1 } }
            }
          }
        }
        // 上游最新版必须 approved 且过消费守卫,否则本步不可跑(下游不推进)
        if (entry.consumes) {
          for (const dep of entry.consumes) {
            const chapter = this.dependencyChapter(entry, dep)
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
      let snapshot: Record<string, AgentConfig> | undefined
      const configs = () => snapshot ??= this.operationConfigs(workId)
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
        const entry = this.definitionFor(currentChapterOf(this.store.getWork(workId)!)).find((d) => d.stepId === state.nextStepId)!
        const outcome = await this.executeEntry(workId, entry, configs)
        if (outcome.kind === 'failed' || entry.gateAfter) return outcome
        lastStepId = entry.stepId
      }
      // 防御:循环上界被触达说明 definition 长度内未收敛
      throw new Error('advance loop exceeded definition length')
    } finally {
      this.advancing.delete(workId)
    }
  }

  private operationConfigs(workId: string): Record<string, AgentConfig> {
    const work = this.store.getWork(workId)
    if (!work) throw new KnownError('work-not-found', 'work not found')
    return structuredClone(this.snapshotConfig?.(work) ?? Object.fromEntries(this.definition.map(entry => [entry.stepId, this.resolveConfig(work, entry.stepId)])))
  }

  private async executeEntry(workId: string, entry: PipelineDefinitionEntry, configs = () => this.operationConfigs(workId), requiredInput?: ArtifactInput): Promise<AdvanceOutcome> {
    let beatCommand: BeatCommandObservation | undefined
    let proseCommand: ProseExecutionObservation | undefined
    try {
      const config = structuredClone(configs()[entry.stepId])
      if (!config) throw new KnownError('config-invalid', 'step configuration is unavailable')
      if (entry.outputKind === 'beat') {
        const result = await observeBeat(workId, 'generate-beat', null, execution => this.runEntry(workId, entry, config, execution, requiredInput), entry.chapter)
        beatCommand = result.command
      } else if (entry.outputKind === 'prose') {
        const result = await observeProse(workId, 'generate-prose', null, execution => this.runEntry(workId, entry, config, execution, requiredInput), entry.chapter)
        proseCommand = result.command
      } else await this.runEntry(workId, entry, config, undefined, requiredInput)
    } catch (err) {
      const cause = err instanceof BeatCommandError || err instanceof ProseCommandError ? err.cause : err
      const known = cause instanceof KnownError ? cause : null
      const code = err instanceof BeatCommandError ? beatFailureCode(cause, err.command.failureStage ?? 'response')
        : err instanceof ProseCommandError ? proseFailureCode(cause, err.command.failureStage ?? 'response') : known?.code ?? 'llm-unavailable'
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
        proseCommand: err instanceof ProseCommandError ? err.command : undefined,
        ...(known?.inputBudget ? { inputBudget: known.inputBudget } : {}),
      }
    }
    this.lastFailure.delete(workId)
    try {
      return { kind: 'advanced', stepId: entry.stepId, state: this.getState(workId), beatCommand, proseCommand }
    } catch (cause) {
      if (proseCommand) throw proseResponseError(workId, proseCommand, cause)
      if (beatCommand?.kind === 'execution-result') throw beatResponseError(workId, beatCommand, cause)
      throw cause
    }
  }

  async startChapter(workId: string, request: StartChapterRequest): Promise<AdvanceOutcome> {
    const parsed = startChapterRequestSchema.parse(request)
    if (this.advancing.has(workId)) throw new KnownError('advance-in-progress', 'generation already running', { retryable: true })
    this.advancing.add(workId)
    try {
      const work = this.store.getWork(workId)
      if (!work) throw new KnownError('work-not-found', 'work not found')
      if (!this.repeatChapters) throw new KnownError('chapter-not-ready', 'continuation is not configured')
      const state = this.getState(workId)
      // A retry is addressed to its original chapter. Even after later progress
      // it is only a read, never permission to generate a different chapter.
      if (work.artifacts.some(a => a.kind === 'beat' && a.chapter === parsed.chapter)) {
        return { kind: state.stage === 'complete' ? 'complete' : 'awaiting-approval', state }
      }
      if (parsed.chapter !== currentChapterOf(work) + 1 || state.stage !== 'complete') throw new KnownError('chapter-not-ready', 'finish the current chapter before starting the next')
      const previous = this.previousChapter(work, parsed.chapter)[1]!
      if (previous.id !== parsed.expectedPreviousProseId || previous.version !== parsed.expectedPreviousProseVersion) throw new KnownError('version-conflict', 'previous chapter has changed')
      const entry = this.definitionFor(parsed.chapter).find(d => d.outputKind === 'beat')!
      const requiredInput: ArtifactInput = { kind: 'prose', chapter: parsed.chapter - 1,
        artifactId: parsed.expectedPreviousProseId, version: parsed.expectedPreviousProseVersion }
      return await this.executeEntry(workId, entry, undefined, requiredInput)
    } finally { this.advancing.delete(workId) }
  }

  // 读模型按定义末端区分三步兼容链与四步设定链。
  async regenerateBeat(workId: string, request: BeatRegenerateRequest) {
    return observeBeat(workId, 'regenerate-beat', { artifactId: request.expectedArtifactId, version: request.expectedHeadVersion }, async execution => {
      if (this.advancing.has(workId)) throw new KnownError('advance-in-progress', 'generation already running', { retryable: true })
      this.advancing.add(workId)
      try {
        const { work, baseline, preconditions } = prepareBeatReview(this.store, workId, request)
        const state = this.getState(workId)
        if (state.stage !== 'awaiting-approval' || state.pendingGate?.kind !== 'beat' || state.pendingGate.chapter !== request.chapter) {
          throw new KnownError('beat-gate-not-ready', 'beat gate not ready')
        }
        const entry = this.definitionFor(request.chapter).find(d => d.outputKind === 'beat' && d.chapter === request.chapter)
        if (!entry) throw new KnownError('beat-gate-not-ready', 'beat step not configured')
        execution.stage = 'input'
        const parsed = beatRegenerateRequestSchema.parse(request)
        assertBeatIds(parsed.content, baseline.content)
        const input = this.inputsFor(work, entry)
        const { upstream, inputs } = input
        const content = { ...parsed.content, writingPlan: parsed.content.writingPlan.map(({ title, content }) => ({ title, content })) }
        execution.stage = 'model'
        const output = await runStep(this.steps.get(entry.stepId)!, {
          workId, seed: work.seed, upstream, chapter: request.chapter, regeneration: { content, instructions: parsed.instructions },
        }, this.operationConfigs(workId)[entry.stepId]!)
        execution.stage = 'output'
        const generated = beatContentSchema.parse(output.content)
        const candidate = assignBeatIds({ ...generated, writingPlan: generated.writingPlan.map(({ title, content }) => ({ title, content })) }, baseline.content)
        execution.stage = 'commit'
        return this.store.appendArtifact(workId, 'beat', candidate, { chapter: request.chapter, inputs, preconditions: [
          ...preconditions, ...input.preconditions, { kind: 'beat', chapter: request.chapter, head: { artifactId: baseline.id, version: baseline.version, humanStatus: 'pending' } },
        ] })
      } finally { this.advancing.delete(workId) }
    }, request.chapter)
  }

  // 创意再生是独立于 advance 的整步操作：caption 只读复用，目标 creative
  // 与 caption 都以同一份快照条件提交，模型完成后才追加新的 pending 方向包。
  async regenerateCreative(workId: string, request: CreativeRegenerateRequest) {
    const parsed = creativeRegenerateRequestSchema.parse(request)
    if (this.advancing.has(workId)) throw new KnownError('advance-in-progress', 'generation already running', { retryable: true })
    this.advancing.add(workId)
    try {
      const work = this.store.getWork(workId)
      if (!work) throw new KnownError('work-not-found', 'work not found')
      const baseline = work.artifacts.find(artifact => artifact.kind === 'creative')
      const hasExpectedTarget = parsed.expectedArtifactId !== null && parsed.expectedHeadVersion !== null
      if (!baseline && hasExpectedTarget) throw new KnownError('version-conflict', 'creative target does not exist')
      if (baseline && (!hasExpectedTarget || baseline.id !== parsed.expectedArtifactId || baseline.version !== parsed.expectedHeadVersion)) {
        throw new KnownError('version-conflict', 'creative head changed')
      }
      if (baseline?.humanStatus === 'approved') throw new KnownError('artifact-already-approved', 'creative is already approved')

      const entry = this.definitionFor(currentChapterOf(work)).find(item => item.outputKind === 'creative')
      if (!entry) throw new KnownError('upstream-changed', 'creative step is not configured')
      const input = this.inputsFor(work, entry)
      const config = this.operationConfigs(workId)[entry.stepId]
      if (!config) throw new KnownError('config-invalid', 'step configuration is unavailable')
      const output = await runStep(this.steps.get(entry.stepId)!, {
        workId,
        seed: work.seed,
        upstream: input.upstream,
        regeneration: { content: baseline?.content ?? null, instructions: parsed.instructions },
      }, config)
      const candidate = creativeContentSchema.parse(output.content)
      return this.store.appendArtifact(workId, 'creative', candidate, {
        humanStatus: 'pending',
        inputs: input.inputs,
        preconditions: [
          ...input.preconditions,
          { kind: 'creative', head: baseline
            ? { artifactId: baseline.id, version: baseline.version, humanStatus: 'pending' }
            : null },
        ],
      })
    } finally { this.advancing.delete(workId) }
  }

  get completionKind(): ArtifactKind | undefined {
    return this.definition.at(-1)?.outputKind
  }

  async regenerateProse(workId: string, request: ProseRegenerateRequest) {
    return observeProse(workId, 'regenerate-prose', { artifactId: request.expectedArtifactId, version: request.expectedHeadVersion }, async execution => {
      if (this.advancing.has(workId)) throw new KnownError('advance-in-progress', 'generation already running', { retryable: true })
      this.advancing.add(workId)
      try {
        const { work, baseline, preconditions } = prepareProseReview(this.store, workId, request)
        const state = this.getState(workId)
        if (state.stage !== 'awaiting-approval' || state.pendingGate?.kind !== 'prose' || state.pendingGate.chapter !== request.chapter) {
          throw new KnownError('prose-gate-not-ready', 'prose gate not ready')
        }
        const entry = this.definitionFor(request.chapter).find(d => d.outputKind === 'prose' && d.chapter === request.chapter)
        if (!entry) throw new KnownError('prose-gate-not-ready', 'prose step not configured')
        execution.stage = 'input'
        const parsed = proseRegenerateRequestSchema.parse(request)
        const input = this.inputsFor(work, entry)
        const { upstream, inputs } = input
        execution.stage = 'model'
        const output = await runStep(this.steps.get(entry.stepId)!, {
          workId, seed: work.seed, upstream, chapter: request.chapter, regeneration: { content: parsed.content, instructions: parsed.instructions },
        }, this.operationConfigs(workId)[entry.stepId]!)
        execution.stage = 'output'
        const candidate = proseContentSchema.parse(output.content)
        execution.stage = 'commit'
        return this.store.appendArtifact(workId, 'prose', candidate, { chapter: request.chapter, inputs, preconditions: [
          ...preconditions, ...input.preconditions, { kind: 'prose', chapter: request.chapter, head: { artifactId: baseline.id, version: baseline.version, humanStatus: 'pending' } },
        ] })
      } finally { this.advancing.delete(workId) }
    }, request.chapter)
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

  private async runEntry(workId: string, entry: PipelineDefinitionEntry, config: AgentConfig, execution?: BeatExecution, requiredInput?: ArtifactInput): Promise<Artifact> {
    const step = this.steps.get(entry.stepId)!
    const work = this.store.getWork(workId)!
    const { upstream, inputs, preconditions: consumedPreconditions } = this.inputsFor(work, entry)
    // A start request binds its predecessor before the configuration snapshot.
    // Recheck the actual sample and retain that original condition at commit.
    if (requiredInput && !inputs.some(input => input.kind === requiredInput.kind && input.chapter === requiredInput.chapter
      && input.artifactId === requiredInput.artifactId && input.version === requiredInput.version)) {
      throw new KnownError('upstream-changed', 'requested input has changed')
    }
    const preconditions: ArtifactPrecondition[] = [{ kind: entry.outputKind, chapter: entry.chapter, head: null }, ...consumedPreconditions]
    if (requiredInput) preconditions.push({ kind: requiredInput.kind, chapter: requiredInput.chapter,
      head: { artifactId: requiredInput.artifactId, version: requiredInput.version, humanStatus: 'approved' } })
    if (entry.outputKind === 'beat' || entry.outputKind === 'prose') {
      for (const prior of this.definitionFor(entry.chapter ?? 1).slice(0, this.definition.findIndex(d => d.stepId === entry.stepId))) {
        const head = work.artifacts.find(a => a.kind === prior.outputKind && a.chapter === prior.chapter)
        if (!head || head.humanStatus !== 'approved' || !this.guardOk(head.kind, head)) {
          throw new KnownError(entry.outputKind === 'prose' ? 'prose-gate-not-ready' : 'beat-gate-not-ready', 'earlier gate not ready')
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
    if (entry.outputKind === 'prose' && !proseContentSchema.safeParse(output.content).success) {
      throw new KnownError('llm-invalid-output', 'invalid prose output', { retryable: true })
    }
    if (execution) execution.stage = 'commit'
    const artifact = this.store.appendArtifact(workId, entry.outputKind, output.content, { preconditions, chapter: entry.chapter,
      humanStatus: entry.gateAfter ? 'pending' : 'approved', ...(entry.chapter ? { inputs } : {}) })
    // Chapter input references persist for continuity warnings; safe logs retain the same bounded identities.
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

  approveOutline(workId: string, request: OutlineApprovalRequest): OutlineApprovalResponse {
    const parsed = outlineApprovalRequestSchema.safeParse(request)
    if (!parsed.success) throw new KnownError('invalid-input', 'invalid outline approval request')
    const work = this.store.getWork(workId)
    if (!work) throw new KnownError('work-not-found', 'work not found')
    const head = work.artifacts.find(artifact => artifact.kind === 'outline' && artifact.chapter === undefined)
    if (!head) throw new KnownError('artifact-not-found', 'outline not found')
    if (head.id !== parsed.data.expectedArtifactId || head.version !== parsed.data.expectedHeadVersion) {
      throw new KnownError('version-conflict', 'outline head changed')
    }
    // Both Store adapters check this head and apply the status in their same atomic write.
    // A matching approved replay is a no-op; it never grants approval to a newer head.
    this.store.setStatus(workId, 'outline', 'approved', { preconditions: [{ kind: 'outline',
      head: { artifactId: head.id, version: head.version, humanStatus: head.humanStatus } }] })
    if (head.humanStatus === 'pending') this.lastFailure.delete(workId)
    return outlineApprovalResponseSchema.parse({ ...head, humanStatus: 'approved' })
  }

  approve(workId: string, kind: ArtifactKind, chapter?: number): void {
    if (kind === 'prose') throw new KnownError('prose-approval-required', 'prose must use its full-content approval command')
    if (kind === 'beat') throw new KnownError('beat-approval-required', 'beat must use its full-content approval command')
    if (kind === 'setting') {
      throw new KnownError('setting-approval-required', 'setting must use its full-content approval command')
    }
    const head = this.store.getWork(workId)?.artifacts.find(a => a.kind === kind && a.chapter === chapter)
    if (!head) throw new KnownError('artifact-not-found', 'artifact not found')
    this.store.setStatus(workId, kind, 'approved', { chapter, preconditions: [{ kind, chapter,
      head: { artifactId: head.id, version: head.version, humanStatus: head.humanStatus } }] })
    this.lastFailure.delete(workId)
  }
}
