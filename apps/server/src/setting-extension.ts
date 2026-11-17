import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  artifactSchema,
  settingContentSchema,
  settingExtensionProposeRequestSchema,
  settingExtensionActionRequestSchema,
  settingExtensionProposalRecordSchema,
  settingExtensionResourceSchema,
  type Artifact,
  type ArtifactRef,
  type SettingExtensionProposalRecord,
  type SettingExtensionProposeRequest,
  type SettingExtensionActionRequest,
  type SettingExtensionReceipt,
  type SettingExtensionResource,
  type WorkDetail,
  type SettingContent,
} from "@agent4novel/contracts";
import { KnownError } from "./errors.js";

export const refOf = (artifact: Artifact): ArtifactRef => ({
  artifactId: artifact.id,
  version: artifact.version,
});
const sameRef = (a: ArtifactRef, b: ArtifactRef): boolean =>
  a.artifactId === b.artifactId && a.version === b.version;
// find：查找元素。
const settingHead = (work: WorkDetail) =>
  work.artifacts.find((a) => a.kind === "setting");
function pendingChapter(work: WorkDetail): boolean {
  for (const artifact of work.artifacts) {
    if (
      (artifact.kind === "beat" || artifact.kind === "prose") &&
      artifact.humanStatus === "pending"
    ) {
      return true;
    }
  }
  return false;
}

function mergedSetting(
  baseline: SettingContent,
  extension: SettingExtensionProposalRecord["extension"],
): SettingContent {
  // assign：合并对象。
  // concat：处理当前步骤。
  return Object.assign({}, baseline, {
    extensions: baseline.extensions.concat([extension]),
  });
}

function isApprovedSetting(
  artifact: Artifact,
  workId: string,
  ref: ArtifactRef,
): boolean {
  // sameRef：处理当前步骤。
  return (
    artifact.workId === workId &&
    artifact.kind === "setting" &&
    artifact.chapter === undefined &&
    artifact.humanStatus === "approved" &&
    sameRef(ref, { artifactId: artifact.id, version: artifact.version })
  );
}

// Readback validator shared by both stores. It deliberately accepts a
// historical candidate; the current Setting head is not its source of truth.
export function isValidApprovedExtensionCandidate(
  record: SettingExtensionProposalRecord,
  candidate: Artifact | undefined,
  base: Artifact | undefined,
): boolean {
  if (record.status !== "approved") {
    return true;
  }
  if (!record.candidate || !candidate || !base) {
    return false;
  }
  // isApprovedSetting：校验当前条件。
  if (!isApprovedSetting(candidate, record.workId, record.candidate)) {
    return false;
  }
  // isApprovedSetting：校验当前条件。
  if (!isApprovedSetting(base, record.workId, record.expectedBase)) {
    return false;
  }
  // safeParse：校验并解析输入。
  const baseline = settingContentSchema.safeParse(base.content);
  if (!baseline.success) {
    return false;
  }
  // mergedSetting：处理当前步骤。
  const expected = mergedSetting(baseline.data, record.extension);
  // isDeepStrictEqual：校验当前条件。
  // isDeepStrictEqual：校验当前条件。
  return (
    isDeepStrictEqual(candidate.content, expected) &&
    isDeepStrictEqual(candidate.inputs, [
      { kind: "setting", ...record.expectedBase },
    ])
  );
}

export function extensionReceipt(
  record: SettingExtensionProposalRecord,
  operation: SettingExtensionReceipt["operation"],
): SettingExtensionReceipt {
  // Propose replay describes the original proposal creation, even after
  // approval.
  return {
    requestId: record.requestId,
    workId: record.workId,
    operation,
    outcome: "success",
    writeOutcome: "committed",
    proposal: { workId: record.workId, requestId: record.requestId },
    candidate: operation === "approve" ? record.candidate : null,
    errorCode: null,
  };
}

const terminalStatuses = { approve: "approved", cancel: "cancelled" } as const;

function chapterImpact(work: WorkDetail) {
  const approved = new Set<number | undefined>();
  const pending = new Set<number | undefined>();
  for (const artifact of work.artifacts) {
    if (artifact.kind === "prose" && artifact.humanStatus === "approved") {
      // add：处理当前步骤。
      approved.add(artifact.chapter);
    }
    if (
      (artifact.kind === "beat" || artifact.kind === "prose") &&
      artifact.humanStatus === "pending"
    ) {
      // add：处理当前步骤。
      pending.add(artifact.chapter);
    }
  }
  // toISOString：转换当前数据。
  return {
    observedAt: new Date().toISOString(),
    approvedChapterCount: approved.size,
    pendingChapterCount: pending.size,
    continuityWarning: approved.size > 0,
    historicalArtifactsUnchanged: true,
    futureGeneration: "uses-after-approval",
    automaticRewrite: false,
    existingFactMutation: false,
  } as const;
}

export function extensionResource(
  work: WorkDetail,
  requestId: string,
  record?: SettingExtensionProposalRecord,
): SettingExtensionResource {
  // chapterImpact：处理当前步骤。
  const common = {
    kind: "setting-extension",
    workId: work.id,
    requestId,
    impact: chapterImpact(work),
  } as const;
  if (!record) {
    // parse：解析输入。
    return settingExtensionResourceSchema.parse({
      ...common,
      status: "none",
      proposal: null,
      base: null,
      extension: null,
      candidate: null,
      createdAt: null,
      updatedAt: null,
    });
  }
  // settingHead：处理当前步骤。
  const head = settingHead(work);
  // sameRef：处理当前步骤。
  // refOf：处理当前步骤。
  const stale =
    record.status === "pending" &&
    (!head ||
      head.humanStatus !== "approved" ||
      !sameRef(refOf(head), record.expectedBase));
  let status: SettingExtensionResource["status"] = record.status;
  if (stale) {
    status = "stale";
  }
  // parse：解析输入。
  return settingExtensionResourceSchema.parse({
    ...common,
    status,
    proposal: { workId: work.id, requestId },
    base: record.expectedBase,
    extension: record.extension,
    candidate: record.candidate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function proposalBase(
  work: WorkDetail,
  request: SettingExtensionProposeRequest,
): Artifact {
  // settingHead：处理当前步骤。
  const head = settingHead(work);
  // sameRef：处理当前步骤。
  // refOf：处理当前步骤。
  if (
    !head ||
    head.humanStatus !== "approved" ||
    !sameRef(refOf(head), request.expectedBase)
  ) {
    throw new KnownError(
      "setting-extension-base-conflict",
      "setting base is not the current approved head",
    );
  }
  // pendingChapter：处理当前步骤。
  if (pendingChapter(work)) {
    throw new KnownError(
      "setting-extension-chapter-pending",
      "a chapter is pending review",
    );
  }
  return head;
}

function newExtension(
  baseline: SettingContent,
  request: SettingExtensionProposeRequest,
) {
  const used = new Set<string>();
  const baselineItems = [
    ...baseline.world,
    ...baseline.characters,
    ...baseline.factions,
    ...baseline.relationships,
  ];
  for (const item of baselineItems) {
    // add：处理当前步骤。
    used.add(item.itemId);
  }
  for (const section of baseline.extensions) {
    // add：处理当前步骤。
    used.add(section.sectionId);
    for (const item of section.items) {
      // add：处理当前步骤。
      used.add(item.itemId);
    }
  }
  const nextId = (prefix: string) => {
    let value: string;
    // randomUUID：生成随机 ID。
    value = `${prefix}-${randomUUID()}`;
    // has：检查存在性。
    while (used.has(value)) {
      // randomUUID：生成随机 ID。
      value = `${prefix}-${randomUUID()}`;
    }
    // add：处理当前步骤。
    used.add(value);
    return value;
  };
  // nextId：处理当前步骤。
  // map：转换数组元素。
  // nextId：处理当前步骤。
  const extension = {
    sectionId: nextId("section"),
    title: request.extension.title,
    items: request.extension.items.map((item) => ({
      ...item,
      itemId: nextId("item"),
    })),
  };
  // safeParse：校验并解析输入。
  // mergedSetting：处理当前步骤。
  if (
    !settingContentSchema.safeParse(mergedSetting(baseline, extension)).success
  ) {
    throw new KnownError(
      "setting-extension-limit",
      "merged setting exceeds logical limits",
    );
  }
  return extension;
}

// The stores call these pure planners *inside* their atomic write boundary.
// Plans validate all content before either a proposal or canonical artifact
// is changed.
export function proposeExtension(
  work: WorkDetail,
  input: SettingExtensionProposeRequest,
  prior?: SettingExtensionProposalRecord,
): SettingExtensionProposalRecord {
  // safeParse：校验并解析输入。
  const parsed = settingExtensionProposeRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new KnownError("invalid-input", "invalid setting extension request");
  }
  const request = parsed.data;
  const persistedRequest = { ...request, workId: work.id };
  if (prior) {
    // isDeepStrictEqual：校验当前条件。
    if (!isDeepStrictEqual(prior.request, persistedRequest)) {
      throw new KnownError(
        "setting-extension-request-conflict",
        "request identity already used",
      );
    }
    return prior;
  }
  // proposalBase：处理当前步骤。
  const head = proposalBase(work, request);
  // parse：解析输入。
  const baseline = settingContentSchema.parse(head.content);
  // newExtension：处理当前步骤。
  const extension = newExtension(baseline, request);
  // toISOString：转换当前数据。
  const now = new Date().toISOString();
  // parse：解析输入。
  return settingExtensionProposalRecordSchema.parse({
    workId: work.id,
    requestId: request.requestId,
    request: persistedRequest,
    expectedBase: request.expectedBase,
    extension,
    status: "pending",
    candidate: null,
    createdAt: now,
    updatedAt: now,
  });
}

function extensionArtifact(
  work: WorkDetail,
  head: Artifact,
  record: SettingExtensionProposalRecord,
  updatedAt: string,
): Artifact {
  // parse：解析输入。
  const baseline = settingContentSchema.parse(head.content);
  // safeParse：校验并解析输入。
  // mergedSetting：处理当前步骤。
  const merged = settingContentSchema.safeParse(
    mergedSetting(baseline, record.extension),
  );
  if (!merged.success) {
    throw new KnownError(
      "setting-extension-invalid",
      "invalid append-only setting extension",
    );
  }
  // parse：解析输入。
  // randomUUID：生成随机 ID。
  return artifactSchema.parse({
    id: `artifact-${randomUUID()}`,
    workId: work.id,
    kind: "setting",
    version: head.version + 1,
    content: merged.data,
    humanStatus: "approved",
    createdAt: updatedAt,
    inputs: [{ kind: "setting", ...record.expectedBase }],
  });
}

function approvedExtension(
  work: WorkDetail,
  record: SettingExtensionProposalRecord,
  updatedAt: string,
) {
  // settingHead：处理当前步骤。
  const head = settingHead(work);
  // sameRef：处理当前步骤。
  // refOf：处理当前步骤。
  if (
    !head ||
    head.humanStatus !== "approved" ||
    !sameRef(refOf(head), record.expectedBase)
  ) {
    throw new KnownError("setting-extension-stale", "setting base changed");
  }
  // pendingChapter：处理当前步骤。
  if (pendingChapter(work)) {
    throw new KnownError(
      "setting-extension-chapter-pending",
      "a chapter is pending review",
    );
  }
  // extensionArtifact：处理当前步骤。
  const artifact = extensionArtifact(work, head, record, updatedAt);
  // refOf：处理当前步骤。
  return {
    artifact,
    record: {
      ...record,
      status: "approved" as const,
      candidate: refOf(artifact),
      updatedAt,
    },
  };
}

type ExtensionActionResult = {
  record: SettingExtensionProposalRecord;
  artifact?: Artifact;
  replay?: boolean;
};

export function actOnExtension(
  work: WorkDetail,
  input: SettingExtensionActionRequest,
  record: SettingExtensionProposalRecord | undefined,
  operation: "approve" | "cancel",
): ExtensionActionResult {
  // safeParse：校验并解析输入。
  const parsed = settingExtensionActionRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new KnownError("invalid-input", "invalid setting extension action");
  }
  if (!record) {
    throw new KnownError(
      "setting-extension-not-found",
      "setting extension not found",
    );
  }
  // sameRef：处理当前步骤。
  if (!sameRef(record.expectedBase, parsed.data.expectedBase)) {
    throw new KnownError(
      "setting-extension-stale",
      "proposal base does not match",
    );
  }
  const terminal = terminalStatuses[operation];
  // Terminal replay precedes head/pending checks, but never the stored-base
  // check.
  if (record.status === terminal) {
    return { record, replay: true };
  }
  if (record.status !== "pending") {
    throw new KnownError(
      "setting-extension-state-conflict",
      "proposal is already terminal",
    );
  }
  // toISOString：转换当前数据。
  const updatedAt = new Date().toISOString();
  if (operation === "cancel") {
    return { record: { ...record, status: "cancelled", updatedAt } };
  }
  // approvedExtension：处理当前步骤。
  return approvedExtension(work, record, updatedAt);
}
