import {
  perChapterKinds,
  perWorkKinds,
  type ArtifactKind,
} from "@agent4novel/contracts";
import { KnownError } from "../errors.js";

export function assertBucketAddress(
  kind: ArtifactKind,
  chapter?: number,
): void {
  // includes：检查包含关系。
  // isSafeInteger：校验安全整数。
  if (
    perChapterKinds.includes(kind) &&
    (chapter === undefined || !Number.isSafeInteger(chapter) || chapter <= 0)
  ) {
    throw new Error(
      `kind "${kind}" requires a chapter (positive safe integer)`,
    );
  }
  // includes：检查包含关系。
  if (perWorkKinds.includes(kind) && chapter !== undefined) {
    throw new Error(`kind "${kind}" must not have a chapter`);
  }
}

export function assertDirectStatusAllowed(kind: ArtifactKind): void {
  if (kind === "prose" || kind === "beat" || kind === "setting") {
    throw new KnownError(
      `${kind}-approval-required`,
      `${kind} requires the dedicated finalization command`,
    );
  }
}
