import {
  proseArtifactSchema,
  proseApproveRequestSchema,
  proseSaveRequestSchema,
  type Artifact,
  type ProseApproveRequest,
  type ProseRegenerateRequest,
  type ProseSaveRequest,
  type HumanStatus,
  type WorkDetail,
} from "@agent4novel/contracts";
import { KnownError } from "./errors.js";
import { approvedUpstream } from "./pipeline/consume-guards.js";
import { observeProse } from "./prose-command.js";
import type { ArtifactPrecondition, WorkStore } from "./store/work-store.js";

type ReviewRequest = Pick<
  ProseRegenerateRequest,
  "chapter" | "expectedArtifactId" | "expectedHeadVersion"
>;

function reviewTarget(
  work: WorkDetail,
  request: ReviewRequest,
  expectedHumanStatus?: HumanStatus,
): Artifact {
  // find：查找元素。
  const target = work.artifacts.find(
    (artifact) =>
      artifact.kind === "prose" && artifact.chapter === request.chapter,
  );
  if (!target) {
    throw new KnownError("artifact-not-found", "prose not found");
  }
  if (
    target.id !== request.expectedArtifactId ||
    target.version !== request.expectedHeadVersion
  ) {
    throw new KnownError("version-conflict", "prose head changed");
  }
  if (
    expectedHumanStatus !== undefined &&
    target.humanStatus !== expectedHumanStatus
  ) {
    throw new KnownError("version-conflict", "prose review state changed");
  }
  if (expectedHumanStatus === undefined && target.humanStatus !== "pending") {
    throw new KnownError("artifact-already-approved", "prose already approved");
  }
  return target;
}

function reviewPreconditions(
  work: WorkDetail,
  chapterNumber: number,
): ArtifactPrecondition[] {
  const preconditions: ArtifactPrecondition[] = [];
  const requiredKinds = [
    "caption",
    "creative",
    "outline",
    "setting",
    "beat",
  ] as const;
  for (const kind of requiredKinds) {
    const chapter = kind === "beat" ? chapterNumber : undefined;
    // 校验 Prose 所需的 approved 上游。
    // approvedUpstream：处理当前步骤。
    const upstream = approvedUpstream(work, kind, chapter, {
      code: "prose-gate-not-ready",
      message: "approve the earlier valid gate first",
    });
    // push：追加元素。
    preconditions.push({
      kind,
      chapter,
      head: {
        artifactId: upstream.id,
        version: upstream.version,
        humanStatus: "approved",
      },
    });
  }
  return preconditions;
}

export function prepareProseReview(
  store: WorkStore,
  workId: string,
  request: ReviewRequest,
  expectedHumanStatus?: HumanStatus,
) {
  // getWork：读取当前数据。
  const work = store.getWork(workId);
  if (!work) {
    throw new KnownError("work-not-found", "work not found");
  }
  // reviewTarget：处理当前步骤。
  const target = reviewTarget(work, request, expectedHumanStatus);
  // 先检查上游，保持 gate 错误优先于 baseline 解析错误。
  // reviewPreconditions：处理当前步骤。
  const preconditions = reviewPreconditions(work, request.chapter);
  // safeParse：校验并解析输入。
  const baseline = proseArtifactSchema.safeParse(target);
  if (!baseline.success) {
    throw new KnownError("prose-gate-not-ready", "invalid stored prose");
  }
  return { work, baseline: baseline.data, preconditions };
}

export function saveProse(
  store: WorkStore,
  workId: string,
  request: ProseSaveRequest,
) {
  // observeProse：记录当前观测。
  return observeProse(
    { workId, chapter: request.chapter },
    "save-prose",
    {
      artifactId: request.expectedArtifactId,
      version: request.expectedHeadVersion,
      humanStatus: request.expectedHumanStatus,
    },
    (execution) => {
      // prepareProseReview：处理当前步骤。
      const { baseline, preconditions } = prepareProseReview(
        store,
        workId,
        request,
        request.expectedHumanStatus,
      );
      // enter：标记执行阶段。
      execution.enter("input");
      // parse：解析输入。
      const content = proseSaveRequestSchema.parse(request).content;
      // enter：标记执行阶段。
      execution.enter("commit");
      // saveArtifact：写入当前结果。
      return store.saveArtifact({
        workId,
        kind: "prose",
        chapter: request.chapter,
        expectedArtifactId: baseline.id,
        expectedHeadVersion: baseline.version,
        expectedHumanStatus: request.expectedHumanStatus,
        content,
        preconditions,
      });
    },
  );
}

export function approveProse(
  store: WorkStore,
  workId: string,
  request: ProseApproveRequest,
) {
  // observeProse：记录当前观测。
  return observeProse(
    { workId, chapter: request.chapter },
    "approve-prose",
    {
      artifactId: request.expectedArtifactId,
      version: request.expectedHeadVersion,
    },
    (execution) => {
      // prepareProseReview：处理当前步骤。
      const { baseline, preconditions } = prepareProseReview(
        store,
        workId,
        request,
      );
      // enter：标记执行阶段。
      execution.enter("input");
      // parse：解析输入。
      const content = proseApproveRequestSchema.parse(request).content;
      // enter：标记执行阶段。
      execution.enter("commit");
      // finalizeArtifact：处理当前步骤。
      return store.finalizeArtifact({
        workId,
        kind: "prose",
        chapter: request.chapter,
        expectedArtifactId: baseline.id,
        expectedHeadVersion: baseline.version,
        content,
        preconditions,
      });
    },
  );
}
