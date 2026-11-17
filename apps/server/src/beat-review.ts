import {
  beatArtifactSchema,
  beatApproveRequestSchema,
  type Artifact,
  type BeatApproveRequest,
  type BeatRegenerateRequest,
  type WorkDetail,
} from "@agent4novel/contracts";
import { KnownError } from "./errors.js";
import { approvedUpstream } from "./pipeline/consume-guards.js";
import { observeBeat } from "./beat-command.js";
import { assignBeatIds } from "./beat-content.js";
import type { ArtifactPrecondition, WorkStore } from "./store/work-store.js";

type ReviewRequest = Pick<
  BeatRegenerateRequest,
  "chapter" | "expectedArtifactId" | "expectedHeadVersion"
>;

function reviewTarget(work: WorkDetail, request: ReviewRequest): Artifact {
  // find：查找元素。
  const target = work.artifacts.find(
    (artifact) =>
      artifact.kind === "beat" && artifact.chapter === request.chapter,
  );
  if (!target) {
    throw new KnownError("beat-gate-not-ready", "beat gate not ready");
  }
  if (
    target.id !== request.expectedArtifactId ||
    target.version !== request.expectedHeadVersion
  ) {
    throw new KnownError("version-conflict", "beat head changed");
  }
  if (target.humanStatus !== "pending") {
    throw new KnownError("artifact-already-approved", "beat already approved");
  }
  return target;
}

function reviewPreconditions(work: WorkDetail): ArtifactPrecondition[] {
  const preconditions: ArtifactPrecondition[] = [];
  for (const kind of ["caption", "creative", "outline", "setting"] as const) {
    // 校验 Beat 所需的 approved 上游。
    // approvedUpstream：处理当前步骤。
    const upstream = approvedUpstream(work, kind, undefined, {
      code: "beat-gate-not-ready",
      message: "approve the earlier valid gate first",
    });
    // push：追加元素。
    preconditions.push({
      kind,
      head: {
        artifactId: upstream.id,
        version: upstream.version,
        humanStatus: "approved",
      },
    });
  }
  return preconditions;
}

export function prepareBeatReview(
  store: WorkStore,
  workId: string,
  request: ReviewRequest,
) {
  // getWork：读取当前数据。
  const work = store.getWork(workId);
  if (!work) {
    throw new KnownError("work-not-found", "work not found");
  }
  // reviewTarget：处理当前步骤。
  const target = reviewTarget(work, request);
  // 先检查上游，保持 gate 错误优先于 baseline 解析错误。
  // reviewPreconditions：处理当前步骤。
  const preconditions = reviewPreconditions(work);
  // safeParse：校验并解析输入。
  const baseline = beatArtifactSchema.safeParse(target);
  if (!baseline.success) {
    throw new KnownError("beat-gate-not-ready", "invalid stored beat");
  }
  return { work, baseline: baseline.data, preconditions };
}

export function approveBeat(
  store: WorkStore,
  workId: string,
  request: BeatApproveRequest,
) {
  // observeBeat：记录当前观测。
  return observeBeat(
    { workId, chapter: request.chapter },
    "approve-beat",
    {
      artifactId: request.expectedArtifactId,
      version: request.expectedHeadVersion,
    },
    (execution) => {
      // prepareBeatReview：处理当前步骤。
      const { baseline, preconditions } = prepareBeatReview(
        store,
        workId,
        request,
      );
      // enter：标记执行阶段。
      execution.enter("input");
      // assignBeatIds：处理当前步骤。
      // parse：解析输入。
      const content = assignBeatIds(
        beatApproveRequestSchema.parse(request).content,
        baseline.content,
      );
      // enter：标记执行阶段。
      execution.enter("commit");
      // finalizeArtifact：处理当前步骤。
      return store.finalizeArtifact({
        workId,
        kind: "beat",
        chapter: request.chapter,
        expectedArtifactId: baseline.id,
        expectedHeadVersion: baseline.version,
        content,
        preconditions,
      });
    },
  );
}
