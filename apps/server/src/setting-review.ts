import {
  settingContentSchema,
  type Artifact,
  type SettingApproveRequest,
  type SettingContent,
  type WorkDetail,
} from "@agent4novel/contracts";
import { z } from "zod";
import { KnownError } from "./errors.js";
import { approvedUpstream } from "./pipeline/consume-guards.js";
import type { ArtifactPrecondition, WorkStore } from "./store/work-store.js";
import { assignSettingIds } from "./setting-content.js";

export class SettingValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    // super：初始化父类。
    super("invalid setting content");
  }
}

function reviewTarget(work: WorkDetail, expectedHeadVersion: number): Artifact {
  // find：查找元素。
  const target = work.artifacts.find((artifact) => artifact.kind === "setting");
  if (!target) {
    throw new KnownError("artifact-not-found", "setting not found");
  }
  if (target.version !== expectedHeadVersion) {
    throw new KnownError("version-conflict", "setting version changed");
  }
  if (target.humanStatus !== "pending") {
    throw new KnownError(
      "artifact-already-approved",
      "setting already approved",
    );
  }
  return target;
}

function reviewPreconditions(work: WorkDetail): ArtifactPrecondition[] {
  const preconditions: ArtifactPrecondition[] = [];
  for (const kind of ["caption", "creative", "outline"] as const) {
    // 校验 Setting 所需的 approved 上游。
    // approvedUpstream：处理当前步骤。
    const artifact = approvedUpstream(work, kind, undefined, {
      code: "setting-gate-not-ready",
      message: "approve the earlier gate first",
    });
    // push：追加元素。
    preconditions.push({
      kind,
      head: {
        artifactId: artifact.id,
        version: artifact.version,
        humanStatus: "approved",
      },
    });
  }
  return preconditions;
}

function approvedContent(
  request: SettingApproveRequest,
  target: Artifact,
): SettingContent {
  // parse：解析输入。
  const baseline = settingContentSchema.parse(target.content);
  try {
    // assignSettingIds：处理当前步骤。
    return assignSettingIds(request.content, baseline);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new SettingValidationError(error.issues);
    }
    throw error;
  }
}

// 准备完整候选后交给 Store 一次条件写入；本模块没有分阶段保存或状态切换。
export function approveSetting(
  store: WorkStore,
  workId: string,
  request: SettingApproveRequest,
) {
  // getWork：读取当前数据。
  const work = store.getWork(workId);
  if (!work) {
    throw new KnownError("work-not-found", "work not found");
  }
  // reviewTarget：处理当前步骤。
  const target = reviewTarget(work, request.expectedHeadVersion);
  // 先检查上游，保持 gate 错误优先于内容转换错误。
  // reviewPreconditions：处理当前步骤。
  const preconditions = reviewPreconditions(work);
  // approvedContent：处理当前步骤。
  const content = approvedContent(request, target);
  // finalizeArtifact：处理当前步骤。
  return store.finalizeArtifact({
    workId,
    kind: "setting",
    expectedArtifactId: target.id,
    expectedHeadVersion: request.expectedHeadVersion,
    content,
    preconditions,
  });
}
