import {
  runStep,
  perChapterKinds,
  beatContentSchema,
  beatArtifactSchema,
  beatRegenerateRequestSchema,
  beatVariantSelectionRequestSchema,
  proseContentSchema,
  proseArtifactSchema,
  proseRegenerateRequestSchema,
  creativeContentSchema,
  creativeRegenerateRequestSchema,
  startChapterRequestSchema,
  outlineApprovalRequestSchema,
  outlineApprovalResponseSchema,
} from "@agent4novel/contracts";
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
  BeatVariantSelectionRequest,
  BeatVariantSelectionResponse,
  BeatVariantComparison,
} from "@agent4novel/contracts";
import { KnownError } from "../errors.js";
import type { ArtifactPrecondition, WorkStore } from "../store/work-store.js";
import {
  observeBeat,
  BeatCommandError,
  beatFailureCode,
  beatResponseError,
  type BeatExecution,
} from "../beat-command.js";
import {
  observeProse,
  ProseCommandError,
  proseFailureCode,
  proseResponseError,
  type ProseExecution,
} from "../prose-command.js";
import type {
  BeatCommandObservation,
  ProseExecutionObservation,
} from "@agent4novel/contracts";
import type {
  BeatRegenerateRequest,
  ProseRegenerateRequest,
} from "@agent4novel/contracts";
import { prepareBeatReview } from "../beat-review.js";
import { prepareProseReview } from "../prose-review.js";
import { assertBeatIds, assignBeatIds } from "../beat-content.js";
import { safeLog } from "../safe-log.js";
import { chapterWorkflow, currentChapterOf } from "../chapter-view.js";
export type {
  AdvanceOutcome,
  GateRef,
  PipelineStage,
  PipelineState,
} from "@agent4novel/contracts";

// 步骤输入(#3c):pipeline 组装上下文 { workId, seed, upstream }。
// seed 是所有步骤的固有输入(不可变即 snapshot);upstream = consumes 声明的上游产物内容,
// 保持 JsonValue(pipeline 泛型),类型精确性由各 step 的 inputSchema 在边界严格恢复。
export type PipelineInput = {
  workId: string;
  seed: string;
  upstream: JsonValue;
  chapter?: number;
  regeneration?: { content: JsonValue; instructions: string };
};
export type PipelineOutput = { content: JsonValue };
export type ArtifactStep = Step<PipelineInput, PipelineOutput>;

export type PipelineDefinitionEntry = {
  stepId: string;
  outputKind: ArtifactKind;
  chapter?: number;
  // 显式上游依赖:只能指向定义中先出现条目的 outputKind(启动校验禁自依赖与环)
  consumes?: ArtifactKind[];
  gateBefore?: GateRef;
  gateAfter?: GateRef;
};

export type PipelineDeps = {
  repeatChapters?: boolean;
  store: WorkStore;
  steps: Map<string, ArtifactStep>;
  definition: PipelineDefinitionEntry[];
  resolveConfig: (work: WorkDetail, stepId: string) => AgentConfig;
  snapshotConfig?: (work: WorkDetail) => Record<string, AgentConfig>;
  // 消费守卫(#3c):consumes 的上游产物除了「最新版 approved」还要过领域校验,
  // 由启动装配层按 kind 注入,pipeline 保持泛型。守卫抛错 = 该产物不算数。
  consumeGuards?: Partial<Record<ArtifactKind, (content: JsonValue) => void>>;
};

type EntryOptions = {
  configs?: () => Record<string, AgentConfig>;
  requiredInput?: ArtifactInput;
  observedWork?: WorkDetail;
};
type CommandResults = {
  beatCommand?: BeatCommandObservation;
  proseCommand?: ProseExecutionObservation;
};

export class Pipeline {
  readonly repeatChapters: boolean;
  private store: WorkStore;
  private steps: Map<string, ArtifactStep>;
  private definition: PipelineDefinitionEntry[];
  private resolveConfig: (work: WorkDetail, stepId: string) => AgentConfig;
  private snapshotConfig?: PipelineDeps["snapshotConfig"];
  private consumeGuards: Partial<
    Record<ArtifactKind, (content: JsonValue) => void>
  >;
  // per-work 内存互斥只覆盖当前进程；SQLite 的写入前置条件在事务内复核，不能靠这把锁做跨进程 lease。
  private advancing = new Set<string>();
  // 最近一次 advance 失败(供读模型 'failed' 态);成功推进或到达关卡即清除
  private lastFailure = new Map<
    string,
    { stepId: string; code: string; retryable: boolean }
  >();

  constructor(deps: PipelineDeps) {
    this.repeatChapters = deps.repeatChapters ?? false;
    this.store = deps.store;
    this.steps = deps.steps;
    this.definition = deps.definition;
    this.resolveConfig = deps.resolveConfig;
    this.snapshotConfig = deps.snapshotConfig;
    this.consumeGuards = deps.consumeGuards ?? {};

    // assertDefinition：校验当前条件。
    this.assertDefinition();
  }

  private assertRepeatedDefinition(): void {
    if (!this.repeatChapters) {
      return;
    }
    // at：处理当前步骤。
    const beat = this.definition.at(-2);
    // at：处理当前步骤。
    const prose = this.definition.at(-1);
    if (
      beat?.outputKind !== "beat" ||
      prose?.outputKind !== "prose" ||
      beat.chapter !== 1 ||
      prose.chapter !== 1
    ) {
      throw new Error(
        "chapter repetition requires the beat#1 / prose#1 template",
      );
    }
  }

  private assertAddress(address: GateRef | undefined): void {
    if (!address) {
      return;
    }
    // includes：检查包含关系。
    const chapterMismatch =
      perChapterKinds.includes(address.kind) !==
      (address.chapter !== undefined);
    // isSafeInteger：校验安全整数。
    const invalidChapter =
      address.chapter !== undefined &&
      (!Number.isSafeInteger(address.chapter) || address.chapter <= 0);
    if (chapterMismatch || invalidChapter) {
      throw new Error("invalid chapter address in pipeline definition");
    }
  }

  private assertEntry(entry: PipelineDefinitionEntry, index: number): void {
    // assertAddress：校验当前条件。
    this.assertAddress({ kind: entry.outputKind, chapter: entry.chapter });
    // assertAddress：校验当前条件。
    this.assertAddress(entry.gateBefore);
    // assertAddress：校验当前条件。
    this.assertAddress(entry.gateAfter);
    if (
      entry.gateAfter &&
      (entry.gateAfter.kind !== entry.outputKind ||
        entry.gateAfter.chapter !== entry.chapter)
    ) {
      throw new Error("gateAfter must match output address");
    }
    // has：检查存在性。
    if (!this.steps.has(entry.stepId)) {
      throw new Error(`step not registered: ${entry.stepId}`);
    }
    // map：转换数组元素。
    // slice：截取片段。
    const prior = new Set(
      this.definition.slice(0, index).map((item) => item.outputKind),
    );
    for (const dependency of entry.consumes ?? []) {
      // has：检查存在性。
      if (!prior.has(dependency)) {
        throw new Error(
          `invalid consumes: "${entry.stepId}" consumes "${dependency}" (must be a prior outputKind)`,
        );
      }
    }
  }

  private assertDefinition(): void {
    // assertRepeatedDefinition：校验当前条件。
    this.assertRepeatedDefinition();
    // map：转换数组元素。
    const ids = new Set(this.definition.map((entry) => entry.stepId));
    if (ids.size !== this.definition.length) {
      throw new Error("duplicate stepId in pipeline definition");
    }
    // map：转换数组元素。
    const kinds = new Set(this.definition.map((entry) => entry.outputKind));
    if (kinds.size !== this.definition.length) {
      throw new Error("duplicate outputKind in pipeline definition");
    }
    // entries：读取对象条目。
    for (const [index, entry] of this.definition.entries()) {
      // assertEntry：校验当前条件。
      this.assertEntry(entry, index);
    }
  }

  private definitionFor(chapter: number): PipelineDefinitionEntry[] {
    if (!this.repeatChapters) {
      return this.definition;
    }
    // map：转换数组元素。
    // includes：检查包含关系。
    // includes：检查包含关系。
    return this.definition.map((entry) =>
      !perChapterKinds.includes(entry.outputKind)
        ? entry
        : {
            ...entry,
            chapter,
            ...(entry.gateAfter
              ? { gateAfter: { ...entry.gateAfter, chapter } }
              : {}),
            ...(entry.gateBefore &&
            perChapterKinds.includes(entry.gateBefore.kind)
              ? { gateBefore: { ...entry.gateBefore, chapter } }
              : {}),
          },
    );
  }

  private dependencyChapter(
    entry: PipelineDefinitionEntry,
    kind: ArtifactKind,
  ): number | undefined {
    // includes：检查包含关系。
    // find：查找元素。
    return this.repeatChapters && perChapterKinds.includes(kind)
      ? entry.chapter
      : this.definition.find((d) => d.outputKind === kind)?.chapter;
  }

  private previousChapter(work: WorkDetail, chapter: number): Artifact[] {
    if (!this.repeatChapters || chapter <= 1) {
      return [];
    }
    // map：转换数组元素。
    return (["beat", "prose"] as const).map((kind) => {
      // find：查找元素。
      const artifact = work.artifacts.find(
        (a) => a.kind === kind && a.chapter === chapter - 1,
      );
      // guardOk：校验当前条件。
      if (
        !artifact ||
        artifact.humanStatus !== "approved" ||
        !this.guardOk(kind, artifact)
      ) {
        throw new KnownError(
          "chapter-not-ready",
          "previous chapter must be approved",
        );
      }
      return artifact;
    });
  }

  private inputsFor(work: WorkDetail, entry: PipelineDefinitionEntry) {
    const upstream: Record<string, JsonValue> = {};
    const sources: Artifact[] = [];
    for (const kind of entry.consumes ?? []) {
      // dependencyChapter：处理当前步骤。
      const chapter = this.dependencyChapter(entry, kind);
      // find：查找元素。
      const artifact = work.artifacts.find(
        (a) => a.kind === kind && a.chapter === chapter,
      );
      if (!artifact || artifact.humanStatus !== "approved") {
        throw new KnownError("upstream-changed", "input is no longer approved");
      }
      // this.consumeGuards[kind]：校验上游内容。
      this.consumeGuards[kind]?.(artifact.content);
      // push：追加元素。
      sources.push(artifact);
      upstream[kind] = artifact.content;
    }
    // previousChapter：处理当前步骤。
    const previous = this.previousChapter(work, entry.chapter ?? 1);
    if (previous.length) {
      upstream.previousChapter = {
        chapter: entry.chapter! - 1,
        beat: previous[0]!.content,
        prose: previous[1]!.content,
      };
      // push：追加元素。
      sources.push(...previous);
    }
    // map：转换数组元素。
    const inputs: ArtifactInput[] = sources.map((a) => ({
      kind: a.kind,
      chapter: a.chapter,
      artifactId: a.id,
      version: a.version,
    }));
    // map：转换数组元素。
    const preconditions: ArtifactPrecondition[] = sources.map((a) => ({
      kind: a.kind,
      chapter: a.chapter,
      head: { artifactId: a.id, version: a.version, humanStatus: "approved" },
    }));
    return { upstream, inputs, preconditions };
  }

  private requireWork(workId: string): WorkDetail {
    // getWork：读取当前数据。
    const work = this.store.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", `work not found: ${workId}`);
    }
    return work;
  }

  getState(workId: string): PipelineState {
    // getStateFromWork：读取当前数据。
    // requireWork：校验当前条件。
    return this.getStateFromWork(this.requireWork(workId));
  }

  private previousChapterState(
    work: WorkDetail,
    entry: PipelineDefinitionEntry,
    latest: Map<string, Artifact>,
  ): PipelineState | null {
    if (!this.repeatChapters || !entry.chapter || entry.chapter <= 1) {
      return null;
    }
    for (const kind of ["beat", "prose"] as const) {
      // get：读取值。
      const previous = latest.get(`${kind}:${entry.chapter - 1}`);
      // guardOk：校验当前条件。
      if (
        !previous ||
        previous.humanStatus !== "approved" ||
        !this.guardOk(kind, previous)
      ) {
        return {
          workId: work.id,
          stage: "blocked",
          nextStepId: entry.stepId,
          pendingGate: { kind, chapter: entry.chapter - 1 },
        };
      }
    }
    return null;
  }

  private dependencyState(
    work: WorkDetail,
    entry: PipelineDefinitionEntry,
    latest: Map<string, Artifact>,
  ): PipelineState | null {
    for (const dependency of entry.consumes ?? []) {
      // dependencyChapter：处理当前步骤。
      const chapter = this.dependencyChapter(entry, dependency);
      // get：读取值。
      const upstream = latest.get(`${dependency}:${chapter ?? ""}`);
      // guardOk：校验当前条件。
      if (
        !upstream ||
        upstream.humanStatus !== "approved" ||
        !this.guardOk(dependency, upstream)
      ) {
        return {
          workId: work.id,
          stage: "blocked",
          nextStepId: entry.stepId,
          pendingGate: { kind: dependency, chapter },
        };
      }
    }
    if (!entry.gateBefore) {
      return null;
    }
    // get：读取值。
    const gate = latest.get(
      `${entry.gateBefore.kind}:${entry.gateBefore.chapter ?? ""}`,
    );
    if (!gate || gate.humanStatus !== "approved") {
      return {
        workId: work.id,
        stage: "blocked",
        nextStepId: entry.stepId,
        pendingGate: entry.gateBefore,
      };
    }
    return null;
  }

  private missingOutputState(
    work: WorkDetail,
    entry: PipelineDefinitionEntry,
    latest: Map<string, Artifact>,
  ): PipelineState | null {
    // previousChapterState：处理当前步骤。
    // dependencyState：处理当前步骤。
    return (
      this.previousChapterState(work, entry, latest) ??
      this.dependencyState(work, entry, latest)
    );
  }

  getStateFromWork(work: WorkDetail): PipelineState {
    const latest = new Map<string, Artifact>();
    for (const artifact of work.artifacts) {
      // set：写入值。
      latest.set(`${artifact.kind}:${artifact.chapter ?? ""}`, artifact);
    }

    // definitionFor：处理当前步骤。
    // currentChapterOf：读取当前数据。
    for (const entry of this.definitionFor(currentChapterOf(work))) {
      // get：读取值。
      const out = latest.get(`${entry.outputKind}:${entry.chapter ?? ""}`);
      if (!out) {
        // missingOutputState：处理当前步骤。
        const blocked = this.missingOutputState(work, entry, latest);
        if (blocked) {
          return blocked;
        }
        return { workId: work.id, stage: "ready", nextStepId: entry.stepId };
      }
      if (out.humanStatus === "pending") {
        return {
          workId: work.id,
          stage: "awaiting-approval",
          nextStepId: null,
          pendingGate: { kind: out.kind, chapter: out.chapter },
        };
      }
      // guardOk：校验当前条件。
      if (!this.guardOk(entry.outputKind, out)) {
        return {
          workId: work.id,
          stage: "blocked",
          nextStepId: entry.stepId,
          pendingGate: { kind: out.kind, chapter: out.chapter },
        };
      }
    }
    return { workId: work.id, stage: "complete", nextStepId: null };
  }

  private pausedAdvance(
    state: PipelineState,
    lastStepId: string | null,
  ): AdvanceOutcome {
    if (lastStepId) {
      return { kind: "advanced", stepId: lastStepId, state };
    }
    return { kind: "awaiting-approval", state };
  }

  // advance = 推进到下一个关卡(链式:auto-approved 步骤连续跑,循环上限 = definition 长度)
  async advance(workId: string): Promise<AdvanceOutcome> {
    // has：检查存在性。
    if (this.advancing.has(workId)) {
      throw new KnownError(
        "advance-in-progress",
        `advance already running: ${workId}`,
        {
          retryable: true,
        },
      );
    }
    // add：处理当前步骤。
    this.advancing.add(workId);
    try {
      let lastStepId: string | null = null;
      let snapshot: Record<string, AgentConfig> | undefined;
      // 上限 +1:最后一次 getState 不落库也要能返回终态
      for (let i = 0; i <= this.definition.length; i++) {
        // requireWork：校验当前条件。
        const work = this.requireWork(workId);
        // getStateFromWork：读取当前数据。
        const state = this.getStateFromWork(work);
        if (state.stage === "complete") {
          return { kind: "complete", state };
        }
        if (state.stage !== "ready" || state.nextStepId === null) {
          // pausedAdvance：处理当前步骤。
          return this.pausedAdvance(state, lastStepId);
        }
        // find：查找元素。
        // definitionFor：处理当前步骤。
        // currentChapterOf：读取当前数据。
        const entry = this.definitionFor(currentChapterOf(work)).find(
          (d) => d.stepId === state.nextStepId,
        )!;
        const configs = () => {
          if (!snapshot) {
            // operationConfigsForWork：处理当前步骤。
            snapshot = this.operationConfigsForWork(work);
          }
          return snapshot;
        };
        // executeEntry：执行当前流程。
        const outcome = await this.executeEntry(workId, entry, {
          configs,
          observedWork: work,
        });
        if (outcome.kind === "failed" || entry.gateAfter) {
          return outcome;
        }
        lastStepId = entry.stepId;
      }
      // 防御:循环上界被触达说明 definition 长度内未收敛
      throw new Error("advance loop exceeded definition length");
    } finally {
      // delete：删除值。
      this.advancing.delete(workId);
    }
  }

  private operationConfigsForWork(
    work: WorkDetail,
  ): Record<string, AgentConfig> {
    if (this.snapshotConfig) {
      // structuredClone：深拷贝数据。
      // snapshotConfig：处理当前步骤。
      return structuredClone(this.snapshotConfig(work));
    }
    const configs: Record<string, AgentConfig> = {};
    for (const entry of this.definition) {
      // resolveConfig：处理当前步骤。
      configs[entry.stepId] = this.resolveConfig(work, entry.stepId);
    }
    // structuredClone：深拷贝数据。
    return structuredClone(configs);
  }

  private operationConfig(
    workId: string,
    entry: PipelineDefinitionEntry,
  ): AgentConfig {
    // operationConfigs：处理当前步骤。
    const config = this.operationConfigs(workId)[entry.stepId];
    if (!config) {
      throw new KnownError(
        "config-invalid",
        "step configuration is unavailable",
      );
    }
    return config;
  }

  private operationConfigs(workId: string): Record<string, AgentConfig> {
    // getWork：读取当前数据。
    const work = this.store.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", "work not found");
    }
    // operationConfigsForWork：处理当前步骤。
    return this.operationConfigsForWork(work);
  }

  private async executeObserved(
    workId: string,
    entry: PipelineDefinitionEntry,
    config: AgentConfig,
    options: EntryOptions,
  ): Promise<CommandResults> {
    // runEntry：执行当前流程。
    const run = (execution: BeatExecution) =>
      this.runEntry(workId, entry, config, {
        execution,
        requiredInput: options.requiredInput,
        observedWork: options.observedWork,
      });
    if (entry.outputKind === "beat") {
      // observeBeat：记录当前观测。
      const result = await observeBeat(
        { workId, chapter: entry.chapter },
        "generate-beat",
        null,
        run,
      );
      return { beatCommand: result.command };
    }
    if (entry.outputKind === "prose") {
      // observeProse：记录当前观测。
      const result = await observeProse(
        { workId, chapter: entry.chapter },
        "generate-prose",
        null,
        run,
      );
      return { proseCommand: result.command };
    }
    // runEntry：执行当前流程。
    await this.runEntry(workId, entry, config, {
      requiredInput: options.requiredInput,
      observedWork: options.observedWork,
    });
    return {};
  }

  private entryFailureCode(
    error: unknown,
    cause: unknown,
    known: KnownError | null,
  ): string {
    if (error instanceof BeatCommandError) {
      // beatFailureCode：处理当前步骤。
      return beatFailureCode(cause, error.command.failureStage ?? "response");
    }
    if (error instanceof ProseCommandError) {
      // proseFailureCode：处理当前步骤。
      return proseFailureCode(cause, error.command.failureStage ?? "response");
    }
    if (known) {
      return known.code;
    }
    return "llm-unavailable";
  }

  private entryFailure(
    workId: string,
    entry: PipelineDefinitionEntry,
    error: unknown,
  ): AdvanceOutcome {
    const cause =
      error instanceof BeatCommandError || error instanceof ProseCommandError
        ? error.cause
        : error;
    const known = cause instanceof KnownError ? cause : null;
    // entryFailureCode：处理当前步骤。
    const code = this.entryFailureCode(error, cause, known);
    const retryable = known
      ? known.code === "upstream-changed" || known.retryable
      : true;
    // recordFailure：写入当前结果。
    this.recordFailure(workId, { stepId: entry.stepId, code, retryable });
    // getState：读取当前数据。
    const failure: AdvanceOutcome = {
      kind: "failed",
      stepId: entry.stepId,
      code,
      retryable,
      attemptId: known?.attemptId,
      state: this.getState(workId),
      beatCommand: undefined,
      proseCommand: undefined,
    };
    if (known?.inputBudget) {
      failure.inputBudget = known.inputBudget;
    }
    if (error instanceof BeatCommandError) {
      failure.beatCommand = error.command;
    }
    if (error instanceof ProseCommandError) {
      failure.proseCommand = error.command;
    }
    return failure;
  }

  private entrySuccess(
    workId: string,
    entry: PipelineDefinitionEntry,
    commands: CommandResults,
  ): AdvanceOutcome {
    // clearFailure：处理当前步骤。
    this.clearFailure(workId);
    try {
      // getState：读取当前数据。
      return {
        kind: "advanced",
        stepId: entry.stepId,
        state: this.getState(workId),
        ...commands,
      };
    } catch (cause) {
      if (commands.proseCommand) {
        // proseResponseError：处理当前步骤。
        throw proseResponseError(workId, commands.proseCommand, cause);
      }
      if (commands.beatCommand?.kind === "execution-result") {
        // beatResponseError：处理当前步骤。
        throw beatResponseError(workId, commands.beatCommand, cause);
      }
      throw cause;
    }
  }

  private async executeEntry(
    workId: string,
    entry: PipelineDefinitionEntry,
    options: EntryOptions = {},
  ): Promise<AdvanceOutcome> {
    let commands: CommandResults;
    try {
      // configs：处理当前步骤。
      // operationConfigs：处理当前步骤。
      const configs = options.configs?.() ?? this.operationConfigs(workId);
      // structuredClone：深拷贝数据。
      const config = structuredClone(configs[entry.stepId]);
      if (!config) {
        throw new KnownError(
          "config-invalid",
          "step configuration is unavailable",
        );
      }
      // executeObserved：执行当前流程。
      commands = await this.executeObserved(workId, entry, config, options);
    } catch (error) {
      // entryFailure：处理当前步骤。
      return this.entryFailure(workId, entry, error);
    }
    // entrySuccess：处理当前步骤。
    return this.entrySuccess(workId, entry, commands);
  }

  private chapterStartWaiting(
    work: WorkDetail,
    parsed: StartChapterRequest,
  ): AdvanceOutcome | null {
    if (!this.repeatChapters) {
      throw new KnownError(
        "chapter-not-ready",
        "continuation is not configured",
      );
    }
    // getState：读取当前数据。
    const state = this.getState(work.id);
    // some：检查任一匹配。
    const existing = work.artifacts.some(
      (artifact) =>
        artifact.kind === "beat" && artifact.chapter === parsed.chapter,
    );
    if (existing) {
      return {
        kind: state.stage === "complete" ? "complete" : "awaiting-approval",
        state,
      };
    }
    // currentChapterOf：读取当前数据。
    if (
      parsed.chapter !== currentChapterOf(work) + 1 ||
      state.stage !== "complete"
    ) {
      throw new KnownError(
        "chapter-not-ready",
        "finish the current chapter before starting the next",
      );
    }
    return null;
  }

  private chapterStartInput(
    work: WorkDetail,
    parsed: StartChapterRequest,
  ): ArtifactInput {
    // previousChapter：处理当前步骤。
    const previousPair = this.previousChapter(work, parsed.chapter);
    const previousBeat = previousPair[0]!;
    const previous = previousPair[1]!;
    // some：检查任一匹配。
    const consumesCurrentBeat = previous.inputs?.some(
      (input) =>
        input.kind === "beat" &&
        input.chapter === parsed.chapter - 1 &&
        input.artifactId === previousBeat.id &&
        input.version === previousBeat.version,
    );
    if (!consumesCurrentBeat) {
      throw new KnownError(
        "chapter-not-ready",
        "previous chapter prose must consume the current approved beat",
      );
    }
    if (
      previous.id !== parsed.expectedPreviousProseId ||
      previous.version !== parsed.expectedPreviousProseVersion
    ) {
      throw new KnownError("version-conflict", "previous chapter has changed");
    }
    return {
      kind: "prose",
      chapter: parsed.chapter - 1,
      artifactId: parsed.expectedPreviousProseId,
      version: parsed.expectedPreviousProseVersion,
    };
  }

  async startChapter(
    workId: string,
    request: StartChapterRequest,
  ): Promise<AdvanceOutcome> {
    // parse：解析输入。
    const parsed = startChapterRequestSchema.parse(request);
    // has：检查存在性。
    if (this.advancing.has(workId)) {
      throw new KnownError(
        "advance-in-progress",
        "generation already running",
        { retryable: true },
      );
    }
    // add：处理当前步骤。
    this.advancing.add(workId);
    try {
      // getWork：读取当前数据。
      const work = this.store.getWork(workId);
      if (!work) {
        throw new KnownError("work-not-found", "work not found");
      }
      // chapterStartWaiting：处理当前步骤。
      const waiting = this.chapterStartWaiting(work, parsed);
      if (waiting) {
        return waiting;
      }
      // chapterStartInput：处理当前步骤。
      const requiredInput = this.chapterStartInput(work, parsed);
      // find：查找元素。
      // definitionFor：处理当前步骤。
      const entry = this.definitionFor(parsed.chapter).find(
        (item) => item.outputKind === "beat",
      )!;
      // executeEntry：执行当前流程。
      return await this.executeEntry(workId, entry, { requiredInput });
    } finally {
      // delete：删除值。
      this.advancing.delete(workId);
    }
  }

  private chapterBeatHeadMatches(
    beat: ReturnType<typeof beatArtifactSchema.parse> | undefined,
    prose: ReturnType<typeof proseArtifactSchema.parse> | undefined,
    request: BeatRegenerateRequest,
  ): boolean {
    const regeneration = request.regeneration!;
    if (!beat || !prose) {
      return false;
    }
    if (
      request.expectedArtifactId !== regeneration.expectedBeat.artifactId ||
      request.expectedHeadVersion !== regeneration.expectedBeat.version ||
      beat.id !== regeneration.expectedBeat.artifactId ||
      beat.version !== regeneration.expectedBeat.version
    ) {
      return false;
    }
    return (
      prose.id === regeneration.expectedProse.artifactId &&
      prose.version === regeneration.expectedProse.version
    );
  }

  private chapterBeatPair(
    work: WorkDetail,
    request: BeatRegenerateRequest,
  ) {
    // safeParse：校验并解析输入。
    // find：查找元素。
    const beat = beatArtifactSchema.safeParse(
      work.artifacts.find(
        (artifact) =>
          artifact.kind === "beat" && artifact.chapter === request.chapter,
      ),
    ).data;
    // safeParse：校验并解析输入。
    // find：查找元素。
    const prose = proseArtifactSchema.safeParse(
      work.artifacts.find(
        (artifact) =>
          artifact.kind === "prose" && artifact.chapter === request.chapter,
      ),
    ).data;
    // chapterBeatHeadMatches：处理当前步骤。
    if (!beat || !prose || !this.chapterBeatHeadMatches(beat, prose, request)) {
      throw new KnownError("version-conflict", "chapter regeneration head changed");
    }
    if (beat.humanStatus !== "approved" || prose.humanStatus !== "approved") {
      throw new KnownError(
        "beat-gate-not-ready",
        "chapter regeneration requires approved beat and prose",
      );
    }
    return { beat, prose };
  }

  private beatRegenerationEntry(request: BeatRegenerateRequest) {
    // find：查找元素。
    // definitionFor：处理当前步骤。
    const entry = this.definitionFor(request.chapter).find(
      (item) =>
        item.outputKind === "beat" && item.chapter === request.chapter,
    );
    if (!entry) {
      throw new KnownError("beat-gate-not-ready", "beat step not configured");
    }
    return entry;
  }

  private beatCandidateContent(
    generated: ReturnType<typeof beatContentSchema.parse>,
    baseline: ReturnType<typeof beatArtifactSchema.parse>,
  ) {
    // assignBeatIds：处理当前步骤。
    // map：转换数组元素。
    return assignBeatIds(
      {
        ...generated,
        writingPlan: generated.writingPlan.map(({ title, content }) => ({
          title,
          content,
        })),
      },
      baseline.content,
    );
  }

  private async beatRegenerationCandidate(
    context: {
      workId: string;
      work: WorkDetail;
      entry: PipelineDefinitionEntry;
      config: AgentConfig | (() => AgentConfig);
      request: BeatRegenerateRequest;
      baseline: ReturnType<typeof beatArtifactSchema.parse>;
    },
    execution: BeatExecution,
  ) {
    // enter：标记执行阶段。
    execution.enter("input");
    // parse：解析输入。
    const parsed = beatRegenerateRequestSchema.parse(context.request);
    // assertBeatIds：校验当前条件。
    assertBeatIds(parsed.content, context.baseline.content);
    // inputsFor：处理当前步骤。
    const input = this.inputsFor(context.work, context.entry);
    // map：转换数组元素。
    const content = {
      ...parsed.content,
      writingPlan: parsed.content.writingPlan.map(({ title, content }) => ({
        title,
        content,
      })),
    };
    // enter：标记执行阶段。
    execution.enter("model");
    // config：处理当前步骤。
    const config =
      typeof context.config === "function"
        ? context.config()
        : context.config;
    // runStep：执行当前流程。
    // get：读取值。
    const output = await runStep(
      this.steps.get(context.entry.stepId)!,
      {
        workId: context.workId,
        seed: context.work.seed,
        upstream: input.upstream,
        chapter: context.request.chapter,
        regeneration: { content, instructions: parsed.instructions },
      },
      config,
    );
    // enter：标记执行阶段。
    execution.enter("output");
    // parse：解析输入。
    const generated = beatContentSchema.parse(output.content);
    // beatCandidateContent：处理当前步骤。
    return {
      candidate: this.beatCandidateContent(generated, context.baseline),
      input,
    };
  }

  private async regenerateChapterBeat(
    workId: string,
    request: BeatRegenerateRequest,
    execution: BeatExecution,
  ) {
    // getWork：读取当前数据。
    const work = this.store.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", "work not found");
    }
    // chapterBeatPair：处理当前步骤。
    const { beat, prose } = this.chapterBeatPair(work, request);
    // beatRegenerationEntry：处理当前步骤。
    const entry = this.beatRegenerationEntry(request);
    // operationConfig：处理当前步骤。
    const config = this.operationConfig(workId, entry);
    // beatRegenerationCandidate：处理当前步骤。
    const generated = await this.beatRegenerationCandidate(
      { workId, work, entry, config, request, baseline: beat },
      execution,
    );
    // enter：标记执行阶段。
    execution.enter("commit");
    // parse：解析输入。
    // appendArtifact：写入当前结果。
    const artifact = beatArtifactSchema.parse(
      this.store.appendArtifact(workId, "beat", generated.candidate, {
        chapter: request.chapter,
        inputs: generated.input.inputs,
        preconditions: [
          ...generated.input.preconditions,
          {
            kind: "beat",
            chapter: request.chapter,
            head: {
              artifactId: beat.id,
              version: beat.version,
              humanStatus: "approved",
            },
          },
          {
            kind: "prose",
            chapter: request.chapter,
            head: {
              artifactId: prose.id,
              version: prose.version,
              humanStatus: "approved",
            },
          },
        ],
      }),
    );
    return { artifact, original: beat };
  }

  private appendPendingBeat(
    workId: string,
    request: BeatRegenerateRequest,
    context: {
      baseline: ReturnType<typeof beatArtifactSchema.parse>;
      preconditions: ArtifactPrecondition[];
      generated: {
        candidate: JsonValue;
        input: {
          inputs: ArtifactInput[];
          preconditions: ArtifactPrecondition[];
        };
      };
    },
  ) {
    // parse：解析输入。
    // appendArtifact：写入当前结果。
    return beatArtifactSchema.parse(
      this.store.appendArtifact(workId, "beat", context.generated.candidate, {
        chapter: request.chapter,
        inputs: context.generated.input.inputs,
        preconditions: [
          ...context.preconditions,
          ...context.generated.input.preconditions,
          {
            kind: "beat",
            chapter: request.chapter,
            head: {
              artifactId: context.baseline.id,
              version: context.baseline.version,
              humanStatus: "pending",
            },
          },
        ],
      }),
    );
  }

  private async regeneratePendingBeat(
    workId: string,
    request: BeatRegenerateRequest,
    execution: BeatExecution,
  ) {
    // prepareBeatReview：处理当前步骤。
    const { work, baseline, preconditions } = prepareBeatReview(
      this.store,
      workId,
      request,
    );
    // chapterWorkflow：处理当前步骤。
    const workflow = chapterWorkflow(
      work,
      request.chapter,
      this.repeatChapters ? "start-next-chapter" : null,
    );
    if (workflow?.workflowState !== "awaiting-beat-review") {
      throw new KnownError("beat-gate-not-ready", "beat gate not ready");
    }
    // beatRegenerationEntry：处理当前步骤。
    const entry = this.beatRegenerationEntry(request);
    // beatRegenerationCandidate：处理当前步骤。
    // operationConfigs：处理当前步骤。
    const generated = await this.beatRegenerationCandidate(
      {
        workId,
        work,
        entry,
        config: () => this.operationConfigs(workId)[entry.stepId]!,
        request,
        baseline,
      },
      execution,
    );
    // enter：标记执行阶段。
    execution.enter("commit");
    // appendPendingBeat：写入当前结果。
    const artifact = this.appendPendingBeat(workId, request, {
      baseline,
      preconditions,
      generated,
    });
    return { artifact, original: baseline };
  }

  async regenerateBeat(workId: string, request: BeatRegenerateRequest) {
    let comparison: BeatVariantComparison | undefined;
    // observeBeat：记录当前观测。
    const observed = await observeBeat(
      {
        workId,
        chapter: request.chapter,
        regeneration: request.regeneration,
      },
      "regenerate-beat",
      {
        artifactId: request.expectedArtifactId,
        version: request.expectedHeadVersion,
      },
      async (execution) => {
        // has：检查存在性。
        if (this.advancing.has(workId)) {
          throw new KnownError(
            "advance-in-progress",
            "generation already running",
            { retryable: true },
          );
        }
        // add：处理当前步骤。
        this.advancing.add(workId);
        try {
          // regenerateChapterBeat：处理当前步骤。
          // regeneratePendingBeat：处理当前步骤。
          const result = request.regeneration
            ? await this.regenerateChapterBeat(workId, request, execution)
            : await this.regeneratePendingBeat(workId, request, execution);
          comparison = {
            original: result.original,
            candidate: result.artifact,
          };
          return result.artifact;
        } finally {
          // delete：删除值。
          this.advancing.delete(workId);
        }
      },
    );
    return { ...observed, comparison: comparison! };
  }

  private currentBeatForSelection(
    work: WorkDetail,
    parsed: BeatVariantSelectionRequest,
  ) {
    // getState：读取当前数据。
    const state = this.getState(work.id);
    if (
      state.stage !== "awaiting-approval" ||
      state.pendingGate?.kind !== "beat" ||
      state.pendingGate.chapter !== parsed.chapter
    ) {
      throw new KnownError("beat-gate-not-ready", "beat gate not ready");
    }
    // safeParse：校验并解析输入。
    // find：查找元素。
    const current = beatArtifactSchema.safeParse(
      work.artifacts.find(
        (artifact) =>
          artifact.kind === "beat" && artifact.chapter === parsed.chapter,
      ),
    ).data;
    if (
      !current ||
      current.id !== parsed.expectedArtifactId ||
      current.version !== parsed.expectedHeadVersion
    ) {
      throw new KnownError("version-conflict", "beat head changed");
    }
    if (current.humanStatus !== "pending") {
      throw new KnownError(
        "artifact-already-approved",
        "beat already approved",
      );
    }
    return current;
  }

  private originalBeatForSelection(
    workId: string,
    parsed: BeatVariantSelectionRequest,
    current: ReturnType<typeof beatArtifactSchema.parse>,
  ) {
    // safeParse：校验并解析输入。
    // getArtifactVersion：读取当前数据。
    const original = beatArtifactSchema.safeParse(
      this.store.getArtifactVersion(
        workId,
        "beat",
        parsed.chapter,
        parsed.originalArtifactId,
        parsed.originalVersion,
      ),
    ).data;
    // stringify：序列化数据。
    // stringify：序列化数据。
    if (
      !original ||
      original.chapter !== parsed.chapter ||
      JSON.stringify(original.content) !==
      JSON.stringify(parsed.originalContent)
    ) {
      throw new KnownError(
        "version-conflict",
        "original beat version is not the requested history",
      );
    }
    if (
      original.version !== current.version - 1 ||
      original.id === current.id ||
      original.humanStatus !== "pending"
    ) {
      throw new KnownError(
        "version-conflict",
        "original beat must be the pending immediate predecessor",
      );
    }
    return original;
  }

  private variantResponse(
    context: {
      current: ReturnType<typeof beatArtifactSchema.parse>;
      original: ReturnType<typeof beatArtifactSchema.parse>;
      choice: BeatVariantSelectionRequest["choice"];
    },
    artifact: ReturnType<typeof beatArtifactSchema.parse>,
    writeOutcome: "committed" | "not-committed",
  ): BeatVariantSelectionResponse {
    return {
      artifact,
      comparison: { original: context.original, candidate: context.current },
      choice: context.choice,
      selection: {
        operation: "select-beat-variant",
        workId: context.current.workId,
        chapter: context.current.chapter,
        expectedHead: {
          artifactId: context.current.id,
          version: context.current.version,
        },
        originalHead: {
          artifactId: context.original.id,
          version: context.original.version,
        },
        choice: context.choice,
        writeOutcome,
        resultHead: {
          artifactId: artifact.id,
          version: artifact.version,
          humanStatus: artifact.humanStatus,
        },
      },
    };
  }

  async selectBeatVariant(
    workId: string,
    request: BeatVariantSelectionRequest,
  ): Promise<BeatVariantSelectionResponse> {
    // parse：解析输入。
    const parsed = beatVariantSelectionRequestSchema.parse(request);
    // has：检查存在性。
    if (this.advancing.has(workId)) {
      throw new KnownError(
        "advance-in-progress",
        "generation already running",
        { retryable: true },
      );
    }
    // add：处理当前步骤。
    this.advancing.add(workId);
    try {
      // getWork：读取当前数据。
      const work = this.store.getWork(workId);
      if (!work) {
        throw new KnownError("work-not-found", "work not found");
      }
      // currentBeatForSelection：读取当前数据。
      const current = this.currentBeatForSelection(work, parsed);
      // originalBeatForSelection：处理当前步骤。
      const original = this.originalBeatForSelection(workId, parsed, current);
      const context = { current, original, choice: parsed.choice };
      if (parsed.choice === "new") {
        // variantResponse：处理当前步骤。
        return this.variantResponse(context, current, "not-committed");
      }
      // parse：解析输入。
      // appendArtifact：写入当前结果。
      const artifact = beatArtifactSchema.parse(
        this.store.appendArtifact(workId, "beat", original.content, {
          chapter: parsed.chapter,
          inputs: original.inputs,
          preconditions: [
            {
              kind: "beat",
              chapter: parsed.chapter,
              head: {
                artifactId: current.id,
                version: current.version,
                humanStatus: "pending",
              },
            },
          ],
        }),
      );
      // variantResponse：处理当前步骤。
      return this.variantResponse(context, artifact, "committed");
    } finally {
      // delete：删除值。
      this.advancing.delete(workId);
    }
  }

  private creativeBaseline(
    work: WorkDetail,
    parsed: CreativeRegenerateRequest,
  ): Artifact | undefined {
    // find：查找元素。
    const baseline = work.artifacts.find(
      (artifact) => artifact.kind === "creative",
    );
    const hasExpectedTarget =
      parsed.expectedArtifactId !== null && parsed.expectedHeadVersion !== null;
    if (!baseline && hasExpectedTarget) {
      throw new KnownError(
        "version-conflict",
        "creative target does not exist",
      );
    }
    if (
      baseline &&
      (!hasExpectedTarget ||
        baseline.id !== parsed.expectedArtifactId ||
        baseline.version !== parsed.expectedHeadVersion)
    ) {
      throw new KnownError("version-conflict", "creative head changed");
    }
    if (baseline?.humanStatus === "approved") {
      throw new KnownError(
        "artifact-already-approved",
        "creative is already approved",
      );
    }
    return baseline;
  }

  private appendCreativeArtifact(
    workId: string,
    baseline: Artifact | undefined,
    input: ReturnType<Pipeline["inputsFor"]>,
    candidate: JsonValue,
  ): Artifact {
    // appendArtifact：写入当前结果。
    return this.store.appendArtifact(workId, "creative", candidate, {
      humanStatus: "pending",
      inputs: input.inputs,
      preconditions: [
        ...input.preconditions,
        {
          kind: "creative",
          head: baseline
            ? {
                artifactId: baseline.id,
                version: baseline.version,
                humanStatus: "pending",
              }
            : null,
        },
      ],
    });
  }

  private async regenerateCreativeArtifact(
    workId: string,
    work: WorkDetail,
    parsed: CreativeRegenerateRequest,
    baseline: Artifact | undefined,
  ): Promise<Artifact> {
    // find：查找元素。
    // definitionFor：处理当前步骤。
    // currentChapterOf：读取当前数据。
    const entry = this.definitionFor(currentChapterOf(work)).find(
      (item) => item.outputKind === "creative",
    );
    if (!entry) {
      throw new KnownError(
        "upstream-changed",
        "creative step is not configured",
      );
    }
    // inputsFor：处理当前步骤。
    const input = this.inputsFor(work, entry);
    // operationConfig：处理当前步骤。
    const config = this.operationConfig(workId, entry);
    // runStep：执行当前流程。
    // get：读取值。
    const output = await runStep(
      this.steps.get(entry.stepId)!,
      {
        workId,
        seed: work.seed,
        upstream: input.upstream,
        regeneration: {
          content: baseline?.content ?? null,
          instructions: parsed.instructions,
        },
      },
      config,
    );
    // parse：解析输入。
    const candidate = creativeContentSchema.parse(output.content);
    // appendCreativeArtifact：写入当前结果。
    return this.appendCreativeArtifact(workId, baseline, input, candidate);
  }

  // 创意再生是独立于 advance 的整步操作：caption 只读复用，目标 creative
  // 与 caption 都以同一份快照条件提交，模型完成后才追加新的 pending 方向包。
  async regenerateCreative(workId: string, request: CreativeRegenerateRequest) {
    // parse：解析输入。
    const parsed = creativeRegenerateRequestSchema.parse(request);
    // has：检查存在性。
    if (this.advancing.has(workId)) {
      throw new KnownError(
        "advance-in-progress",
        "generation already running",
        { retryable: true },
      );
    }
    // add：处理当前步骤。
    this.advancing.add(workId);
    try {
      // getWork：读取当前数据。
      const work = this.store.getWork(workId);
      if (!work) {
        throw new KnownError("work-not-found", "work not found");
      }
      // creativeBaseline：处理当前步骤。
      const baseline = this.creativeBaseline(work, parsed);
      // regenerateCreativeArtifact：处理当前步骤。
      return await this.regenerateCreativeArtifact(
        workId,
        work,
        parsed,
        baseline,
      );
    } finally {
      // delete：删除值。
      this.advancing.delete(workId);
    }
  }

  get completionKind(): ArtifactKind | undefined {
    // at：处理当前步骤。
    return this.definition.at(-1)?.outputKind;
  }

  private chapterProseHeadMatches(
    beat: ReturnType<typeof beatArtifactSchema.parse> | undefined,
    prose: ReturnType<typeof proseArtifactSchema.parse> | undefined,
    request: ProseRegenerateRequest,
  ): boolean {
    const regeneration = request.regeneration!;
    if (!beat || !prose) {
      return false;
    }
    if (
      request.expectedArtifactId !== regeneration.expectedProse.artifactId ||
      request.expectedHeadVersion !== regeneration.expectedProse.version ||
      beat.id !== regeneration.expectedBeat.artifactId ||
      beat.version !== regeneration.expectedBeat.version
    ) {
      return false;
    }
    return (
      prose.id === regeneration.expectedProse.artifactId &&
      prose.version === regeneration.expectedProse.version
    );
  }

  private chapterProsePair(
    work: WorkDetail,
    request: ProseRegenerateRequest,
  ) {
    // safeParse：校验并解析输入。
    // find：查找元素。
    const beat = beatArtifactSchema.safeParse(
      work.artifacts.find(
        (artifact) =>
          artifact.kind === "beat" && artifact.chapter === request.chapter,
      ),
    ).data;
    // safeParse：校验并解析输入。
    // find：查找元素。
    const prose = proseArtifactSchema.safeParse(
      work.artifacts.find(
        (artifact) =>
          artifact.kind === "prose" && artifact.chapter === request.chapter,
      ),
    ).data;
    // chapterProseHeadMatches：处理当前步骤。
    if (
      !beat ||
      !prose ||
      !this.chapterProseHeadMatches(beat, prose, request)
    ) {
      throw new KnownError(
        "version-conflict",
        "chapter regeneration head changed",
      );
    }
    if (beat.humanStatus !== "approved" || prose.humanStatus !== "approved") {
      throw new KnownError(
        "prose-gate-not-ready",
        "chapter regeneration requires an approved beat and prose",
      );
    }
    // find：查找元素。
    const priorBeatInput = prose.inputs?.find(
      (input) => input.kind === "beat" && input.chapter === request.chapter,
    );
    if (
      !priorBeatInput ||
      (priorBeatInput.artifactId === beat.id &&
        priorBeatInput.version === beat.version)
    ) {
      throw new KnownError(
        "prose-gate-not-ready",
        "chapter beat has not been replanned or its source is unavailable",
      );
    }
    return { beat, prose };
  }

  private proseRegenerationEntry(request: ProseRegenerateRequest) {
    // find：查找元素。
    // definitionFor：处理当前步骤。
    const entry = this.definitionFor(request.chapter).find(
      (item) =>
        item.outputKind === "prose" && item.chapter === request.chapter,
    );
    if (!entry) {
      throw new KnownError("prose-gate-not-ready", "prose step not configured");
    }
    return entry;
  }

  private async proseRegenerationCandidate(
    context: {
      workId: string;
      work: WorkDetail;
      entry: PipelineDefinitionEntry;
      config: AgentConfig | (() => AgentConfig);
      request: ProseRegenerateRequest;
    },
    execution: ProseExecution,
  ) {
    // enter：标记执行阶段。
    execution.enter("input");
    // parse：解析输入。
    const parsed = proseRegenerateRequestSchema.parse(context.request);
    // inputsFor：处理当前步骤。
    const input = this.inputsFor(context.work, context.entry);
    // enter：标记执行阶段。
    execution.enter("model");
    // config：处理当前步骤。
    const config =
      typeof context.config === "function"
        ? context.config()
        : context.config;
    // runStep：执行当前流程。
    // get：读取值。
    const output = await runStep(
      this.steps.get(context.entry.stepId)!,
      {
        workId: context.workId,
        seed: context.work.seed,
        upstream: input.upstream,
        chapter: context.request.chapter,
        regeneration: {
          content: parsed.content,
          instructions: parsed.instructions,
        },
      },
      config,
    );
    // enter：标记执行阶段。
    execution.enter("output");
    // parse：解析输入。
    return { candidate: proseContentSchema.parse(output.content), input };
  }

  private async regenerateChapterProse(
    workId: string,
    request: ProseRegenerateRequest,
    execution: ProseExecution,
  ) {
    // getWork：读取当前数据。
    const work = this.store.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", "work not found");
    }
    // chapterProsePair：处理当前步骤。
    const { prose } = this.chapterProsePair(work, request);
    // proseRegenerationEntry：处理当前步骤。
    const entry = this.proseRegenerationEntry(request);
    // operationConfig：处理当前步骤。
    const config = this.operationConfig(workId, entry);
    // proseRegenerationCandidate：处理当前步骤。
    const generated = await this.proseRegenerationCandidate(
      { workId, work, entry, config, request },
      execution,
    );
    // enter：标记执行阶段。
    execution.enter("commit");
    // appendArtifact：写入当前结果。
    return this.store.appendArtifact(workId, "prose", generated.candidate, {
      chapter: request.chapter,
      inputs: generated.input.inputs,
      preconditions: [
        ...generated.input.preconditions,
        {
          kind: "prose",
          chapter: request.chapter,
          head: {
            artifactId: prose.id,
            version: prose.version,
            humanStatus: "approved",
          },
        },
      ],
    });
  }

  private async regeneratePendingProse(
    workId: string,
    request: ProseRegenerateRequest,
    execution: ProseExecution,
  ) {
    // prepareProseReview：处理当前步骤。
    const { work, baseline, preconditions } = prepareProseReview(
      this.store,
      workId,
      request,
    );
    // chapterWorkflow：处理当前步骤。
    const workflow = chapterWorkflow(
      work,
      request.chapter,
      this.repeatChapters ? "start-next-chapter" : null,
    );
    if (workflow?.workflowState !== "awaiting-prose-review") {
      throw new KnownError("prose-gate-not-ready", "prose gate not ready");
    }
    // proseRegenerationEntry：处理当前步骤。
    const entry = this.proseRegenerationEntry(request);
    // proseRegenerationCandidate：处理当前步骤。
    // operationConfigs：处理当前步骤。
    const generated = await this.proseRegenerationCandidate(
      {
        workId,
        work,
        entry,
        config: () => this.operationConfigs(workId)[entry.stepId]!,
        request,
      },
      execution,
    );
    // enter：标记执行阶段。
    execution.enter("commit");
    // appendArtifact：写入当前结果。
    return this.store.appendArtifact(workId, "prose", generated.candidate, {
      chapter: request.chapter,
      inputs: generated.input.inputs,
      preconditions: [
        ...preconditions,
        ...generated.input.preconditions,
        {
          kind: "prose",
          chapter: request.chapter,
          head: {
            artifactId: baseline.id,
            version: baseline.version,
            humanStatus: "pending",
          },
        },
      ],
    });
  }

  async regenerateProse(workId: string, request: ProseRegenerateRequest) {
    // observeProse：记录当前观测。
    return observeProse(
      {
        workId,
        chapter: request.chapter,
        regeneration: request.regeneration,
      },
      "regenerate-prose",
      {
        artifactId: request.expectedArtifactId,
        version: request.expectedHeadVersion,
      },
      async (execution) => {
        // has：检查存在性。
        if (this.advancing.has(workId)) {
          throw new KnownError(
            "advance-in-progress",
            "generation already running",
            { retryable: true },
          );
        }
        // add：处理当前步骤。
        this.advancing.add(workId);
        try {
          if (request.regeneration) {
            // regenerateChapterProse：处理当前步骤。
            return await this.regenerateChapterProse(
              workId,
              request,
              execution,
            );
          }
          // regeneratePendingProse：处理当前步骤。
          return await this.regeneratePendingProse(workId, request, execution);
        } finally {
          // delete：删除值。
          this.advancing.delete(workId);
        }
      },
    );
  }

  // 读模型用:最近一次失败(无 → null)。审批等人工动作也会清掉它。
  failureOf(
    workId: string,
    nextStepId: string | null,
  ): { stepId: string; code: string; retryable: boolean } | null {
    // get：读取值。
    const failure = this.lastFailure.get(workId);
    if (!failure) {
      return null;
    }
    if (nextStepId !== undefined && failure.stepId !== nextStepId) {
      // clearFailure：处理当前步骤。
      this.clearFailure(workId);
      return null;
    }
    return failure;
  }

  clearFailure(workId: string): void {
    // delete：删除值。
    this.lastFailure.delete(workId);
  }

  private recordFailure(
    workId: string,
    // bits:allow(BCS004): retryable 是失败读模型的数据字段，不是行为切换开关
    failure: { stepId: string; code: string; retryable: boolean },
  ): void {
    // delete：删除值。
    this.lastFailure.delete(workId);
    if (this.lastFailure.size >= 1000) {
      // next：处理当前步骤。
      // keys：读取对象键。
      const oldest = this.lastFailure.keys().next().value;
      if (oldest !== undefined) {
        // delete：删除值。
        this.lastFailure.delete(oldest);
      }
    }
    // set：写入值。
    this.lastFailure.set(workId, failure);
  }

  private guardOk(kind: ArtifactKind, artifact: Artifact): boolean {
    const guard = this.consumeGuards[kind];
    if (!guard) {
      return true;
    }
    try {
      // guard：校验当前条件。
      guard(artifact.content);
      return true;
    } catch (error) {
      void error;
    }
    return false;
  }

  private prepareEntryInputs(
    work: WorkDetail,
    entry: PipelineDefinitionEntry,
    requiredInput?: ArtifactInput,
  ) {
    // inputsFor：处理当前步骤。
    const prepared = this.inputsFor(work, entry);
    // some：检查任一匹配。
    if (
      requiredInput &&
      !prepared.inputs.some(
        (input) =>
          input.kind === requiredInput.kind &&
          input.chapter === requiredInput.chapter &&
          input.artifactId === requiredInput.artifactId &&
          input.version === requiredInput.version,
      )
    ) {
      throw new KnownError("upstream-changed", "requested input has changed");
    }
    const preconditions: ArtifactPrecondition[] = [
      { kind: entry.outputKind, chapter: entry.chapter, head: null },
      ...prepared.preconditions,
    ];
    if (requiredInput) {
      // push：追加元素。
      preconditions.push({
        kind: requiredInput.kind,
        chapter: requiredInput.chapter,
        head: {
          artifactId: requiredInput.artifactId,
          version: requiredInput.version,
          humanStatus: "approved",
        },
      });
    }
    return { ...prepared, preconditions };
  }

  private assertEntryGates(
    work: WorkDetail,
    entry: PipelineDefinitionEntry,
    preconditions: ArtifactPrecondition[],
  ): void {
    if (entry.outputKind !== "beat" && entry.outputKind !== "prose") {
      return;
    }
    // slice：截取片段。
    // definitionFor：处理当前步骤。
    // findIndex：读取当前数据。
    const priorEntries = this.definitionFor(entry.chapter ?? 1).slice(
      0,
      this.definition.findIndex((item) => item.stepId === entry.stepId),
    );
    for (const prior of priorEntries) {
      // find：查找元素。
      const head = work.artifacts.find(
        (artifact) =>
          artifact.kind === prior.outputKind &&
          artifact.chapter === prior.chapter,
      );
      // guardOk：校验当前条件。
      if (
        !head ||
        head.humanStatus !== "approved" ||
        !this.guardOk(head.kind, head)
      ) {
        throw new KnownError(
          entry.outputKind === "prose"
            ? "prose-gate-not-ready"
            : "beat-gate-not-ready",
          "earlier gate not ready",
        );
      }
      // some：检查任一匹配。
      const consumed = preconditions.some(
        (condition) =>
          condition.kind === head.kind && condition.chapter === head.chapter,
      );
      if (!consumed) {
        // push：追加元素。
        preconditions.push({
          kind: head.kind,
          chapter: head.chapter,
          head: {
            artifactId: head.id,
            version: head.version,
            humanStatus: "approved",
          },
        });
      }
    }
  }

  private assertEntryOutput(
    entry: PipelineDefinitionEntry,
    output: PipelineOutput,
  ): void {
    // safeParse：校验并解析输入。
    if (
      entry.outputKind === "beat" &&
      !beatContentSchema.safeParse(output.content).success
    ) {
      throw new KnownError("llm-invalid-output", "invalid beat output", {
        retryable: true,
      });
    }
    // safeParse：校验并解析输入。
    if (
      entry.outputKind === "prose" &&
      !proseContentSchema.safeParse(output.content).success
    ) {
      throw new KnownError("llm-invalid-output", "invalid prose output", {
        retryable: true,
      });
    }
  }

  private logEntry(context: {
    workId: string;
    work: WorkDetail;
    entry: PipelineDefinitionEntry;
    preconditions: ArtifactPrecondition[];
    artifact: Artifact;
  }): void {
    // fromEntries：从条目构造对象。
    // filter：筛选元素。
    // map：转换数组元素。
    // find：查找元素。
    const consumed = Object.fromEntries(
      (context.entry.consumes ?? [])
        .map((dependency) => [
          dependency,
          context.preconditions.find(
            (condition) => condition.kind === dependency,
          )?.head?.version,
        ])
        .filter(([, version]) => version !== undefined),
    );
    // safeLog：处理当前步骤。
    safeLog({
      event: "pipeline.step",
      workId: context.workId,
      stepId: context.entry.stepId,
      outputKind: context.entry.outputKind,
      chapter: context.entry.chapter,
      outputVersion: context.artifact.version,
      consumed,
      seedChars: context.work.seed.length,
    });
  }

  private async runEntry(
    workId: string,
    entry: PipelineDefinitionEntry,
    config: AgentConfig,
    options: {
      execution?: BeatExecution;
      requiredInput?: ArtifactInput;
      observedWork?: WorkDetail;
    } = {},
  ): Promise<Artifact> {
    // getWork：读取当前数据。
    const work = options.observedWork ?? this.store.getWork(workId)!;
    // prepareEntryInputs：处理当前步骤。
    const prepared = this.prepareEntryInputs(
      work,
      entry,
      options.requiredInput,
    );
    // assertEntryGates：校验当前条件。
    this.assertEntryGates(work, entry, prepared.preconditions);
    // enter：标记执行阶段。
    options.execution?.enter("model");
    // runStep：执行当前流程。
    // get：读取值。
    const output = await runStep(
      this.steps.get(entry.stepId)!,
      {
        workId,
        seed: work.seed,
        upstream: prepared.upstream,
        chapter: entry.chapter,
      },
      config,
    );
    // enter：标记执行阶段。
    options.execution?.enter("output");
    // assertEntryOutput：校验当前条件。
    this.assertEntryOutput(entry, output);
    // enter：标记执行阶段。
    options.execution?.enter("commit");
    // appendArtifact：写入当前结果。
    const artifact = this.store.appendArtifact(
      workId,
      entry.outputKind,
      output.content,
      {
        preconditions: prepared.preconditions,
        chapter: entry.chapter,
        humanStatus: entry.gateAfter ? "pending" : "approved",
        inputs: prepared.inputs,
      },
    );
    // logEntry：写入当前结果。
    this.logEntry({ workId, work, entry, ...prepared, artifact });
    return artifact;
  }

  approveOutline(
    workId: string,
    request: OutlineApprovalRequest,
  ): OutlineApprovalResponse {
    // safeParse：校验并解析输入。
    const parsed = outlineApprovalRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new KnownError("invalid-input", "invalid outline approval request");
    }
    // getWork：读取当前数据。
    const work = this.store.getWork(workId);
    if (!work) {
      throw new KnownError("work-not-found", "work not found");
    }
    // find：查找元素。
    const head = work.artifacts.find(
      (artifact) =>
        artifact.kind === "outline" && artifact.chapter === undefined,
    );
    if (!head) {
      throw new KnownError("artifact-not-found", "outline not found");
    }
    if (
      head.id !== parsed.data.expectedArtifactId ||
      head.version !== parsed.data.expectedHeadVersion
    ) {
      throw new KnownError("version-conflict", "outline head changed");
    }
    // Both Store adapters check this head and apply the status in their same
    // atomic write. A matching approved replay is a no-op; it never grants
    // approval to a newer head.
    // setStatus：处理当前步骤。
    this.store.setStatus(workId, "outline", "approved", {
      preconditions: [
        {
          kind: "outline",
          head: {
            artifactId: head.id,
            version: head.version,
            humanStatus: head.humanStatus,
          },
        },
      ],
    });
    if (head.humanStatus === "pending") {
      // clearFailure：处理当前步骤。
      this.clearFailure(workId);
    }
    // parse：解析输入。
    return outlineApprovalResponseSchema.parse({
      ...head,
      humanStatus: "approved",
    });
  }

  approve(workId: string, kind: ArtifactKind, chapter?: number): void {
    if (kind === "prose") {
      throw new KnownError(
        "prose-approval-required",
        "prose must use its full-content approval command",
      );
    }
    if (kind === "beat") {
      throw new KnownError(
        "beat-approval-required",
        "beat must use its full-content approval command",
      );
    }
    if (kind === "setting") {
      throw new KnownError(
        "setting-approval-required",
        "setting must use its full-content approval command",
      );
    }
    // find：查找元素。
    // getWork：读取当前数据。
    const head = this.store
      .getWork(workId)
      ?.artifacts.find((a) => a.kind === kind && a.chapter === chapter);
    if (!head) {
      throw new KnownError("artifact-not-found", "artifact not found");
    }
    // setStatus：处理当前步骤。
    this.store.setStatus(workId, kind, "approved", {
      chapter,
      preconditions: [
        {
          kind,
          chapter,
          head: {
            artifactId: head.id,
            version: head.version,
            humanStatus: head.humanStatus,
          },
        },
      ],
    });
    // clearFailure：处理当前步骤。
    this.clearFailure(workId);
  }
}
