import { createApp } from "../app.js";
import { consumeGuards } from "../pipeline/consume-guards.js";
import { Pipeline } from "../pipeline/pipeline.js";
import type {
  ArtifactStep,
  PipelineDefinitionEntry,
} from "../pipeline/pipeline.js";
import { createCaptionStep } from "../steps/caption-step.js";
import { createCreativeStep } from "../steps/creative-step.js";
import { createOutlineStep } from "../steps/outline-step.js";
import { createSettingStep } from "../steps/setting-step.js";
import { createBeatStep } from "../steps/beat-step.js";
import { createProseStep } from "../steps/prose-step.js";
import {
  createFakeCaptionStep,
  createFakeCreativeStep,
  createFakeOutlineStep,
  createFakeSettingStep,
  createFakeBeatStep,
  createFakeProseStep,
} from "../steps/fake-step.js";
import { modelRuntime } from "../steps/llm.js";
import type { WorkStore } from "../store/work-store.js";
import { AuthorConfigService } from "../config/author-config-service.js";
import type { AuthorConfigRepository } from "../config/author-config-repository.js";
import type { BadExampleRepository } from "../bad-examples/repository.js";

function productionAuthorConfig(
  store: WorkStore,
  dataDir: string | undefined,
  pipelineRef: { current?: Pipeline },
): AuthorConfigService | undefined {
  const repository = store as WorkStore & Partial<AuthorConfigRepository>;
  if (!dataDir) {
    return undefined;
  }
  const supported =
    typeof repository.getAuthorConfig === "function" &&
    typeof repository.saveAuthorConfig === "function" &&
    typeof repository.getAuthorConfigReceipt === "function" &&
    typeof repository.listAgentFiles === "function" &&
    typeof repository.putAgentFile === "function";
  if (!supported) {
    return undefined;
  }
  // clearFailure：处理当前步骤。
  return new AuthorConfigService(
    store,
    repository as WorkStore & AuthorConfigRepository,
    dataDir,
    {
      runtime: modelRuntime,
      onSaved: (workId) => pipelineRef.current?.clearFailure(workId),
    },
  );
}

function productionSteps(mode: "demo" | "live"): Map<string, ArtifactStep> {
  // createFakeCaptionStep：构造当前数据。
  // createCaptionStep：构造当前数据。
  // createFakeCreativeStep：构造当前数据。
  // createCreativeStep：构造当前数据。
  // createFakeOutlineStep：构造当前数据。
  // createOutlineStep：构造当前数据。
  // createFakeSettingStep：构造当前数据。
  // createSettingStep：构造当前数据。
  // createFakeBeatStep：构造当前数据。
  // createBeatStep：构造当前数据。
  // createFakeProseStep：构造当前数据。
  // createProseStep：构造当前数据。
  return new Map<string, ArtifactStep>([
    [
      "caption",
      mode === "demo" ? createFakeCaptionStep() : createCaptionStep(),
    ],
    [
      "creative",
      mode === "demo" ? createFakeCreativeStep() : createCreativeStep(),
    ],
    [
      "outline",
      mode === "demo" ? createFakeOutlineStep() : createOutlineStep(),
    ],
    [
      "setting",
      mode === "demo" ? createFakeSettingStep() : createSettingStep(),
    ],
    ["beat", mode === "demo" ? createFakeBeatStep() : createBeatStep()],
    ["prose", mode === "demo" ? createFakeProseStep() : createProseStep()],
  ]);
}

function productionDefinition(): PipelineDefinitionEntry[] {
  return [
    { stepId: "caption", outputKind: "caption" },
    {
      stepId: "creative",
      outputKind: "creative",
      consumes: ["caption"],
      gateAfter: { kind: "creative" },
    },
    {
      stepId: "outline",
      outputKind: "outline",
      consumes: ["creative"],
      gateAfter: { kind: "outline" },
    },
    {
      stepId: "setting",
      outputKind: "setting",
      consumes: ["caption", "creative", "outline"],
      gateAfter: { kind: "setting" },
    },
    {
      stepId: "beat",
      outputKind: "beat",
      chapter: 1,
      consumes: ["outline", "setting"],
      gateAfter: { kind: "beat", chapter: 1 },
    },
    {
      stepId: "prose",
      outputKind: "prose",
      chapter: 1,
      consumes: ["beat", "setting"],
      gateAfter: { kind: "prose", chapter: 1 },
    },
  ];
}

export function createProductionApp(
  store: WorkStore,
  webRoot?: string,
  dataDir?: string,
) {
  // 无可用模型凭据 → fake 演示模式（不报错、不触网）。
  const demo = modelRuntime.mode === "demo";
  const pipelineRef: { current?: Pipeline } = {};
  // productionAuthorConfig：处理当前步骤。
  const authorConfig = productionAuthorConfig(store, dataDir, pipelineRef);
  // productionSteps：处理当前步骤。
  // productionDefinition：处理当前步骤。
  // snapshot：处理当前步骤。
  const pipeline = (pipelineRef.current = new Pipeline({
    store,
    steps: productionSteps(modelRuntime.mode),
    definition: productionDefinition(),
    repeatChapters: true,
    resolveConfig: (work) => work.config,
    ...(authorConfig
      ? { snapshotConfig: (work) => authorConfig.snapshot(work) }
      : {}),
    consumeGuards,
  }));

  const badRepository = store as WorkStore & Partial<BadExampleRepository>;
  const badExamples =
    typeof badRepository.markBadExample === "function" &&
    typeof badRepository.getBadExample === "function" &&
    typeof badRepository.listBadExamples === "function"
      ? (badRepository as BadExampleRepository)
      : undefined;
  // createApp：构造当前数据。
  const app = createApp({
    store,
    pipeline,
    meta: { demo },
    webRoot,
    authorConfig,
    badExamples,
  });

  return { app, demo };
}
