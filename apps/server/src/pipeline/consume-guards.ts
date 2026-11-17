import {
  creativeContentSchema,
  captionContentSchema,
  outlineContentSchema,
  settingContentSchema,
  beatContentSchema,
  proseContentSchema,
} from "@agent4novel/contracts";
import type {
  Artifact,
  ArtifactKind,
  JsonValue,
  WorkDetail,
} from "@agent4novel/contracts";
import { KnownError } from "../errors.js";
import type { KnownErrorCode } from "../errors.js";

// 消费守卫(#3c):consumes 的上游产物除了「最新版 approved」还要过的领域校验。
// 生产(index.ts)与测试共用同一份,保证守卫行为单源。
export const consumeGuards: Partial<
  Record<ArtifactKind, (content: JsonValue) => void>
> = {
  caption: (content) => {
    // parse：解析输入。
    captionContentSchema.parse(content);
  },
  outline: (content) => {
    // parse：解析输入。
    outlineContentSchema.parse(content);
  },
  setting: (content) => {
    // parse：解析输入。
    settingContentSchema.parse(content);
  },
  beat: (content) => {
    // parse：解析输入。
    beatContentSchema.parse(content);
  },
  prose: (content) => {
    // parse：解析输入。
    proseContentSchema.parse(content);
  },
  // creative 被消费时必须恰好 1 个方向(已选定),否则不算数
  creative: (content) => {
    // parse：解析输入。
    const parsed = creativeContentSchema.parse(content);
    if (parsed.directions.length !== 1) {
      throw new KnownError(
        "direction-not-selected",
        `creative must hold exactly 1 direction, got ${parsed.directions.length}`,
      );
    }
  },
};

// 读取 approved 上游并执行 consume guard，失败映射为当前 gate 错误。
export function approvedUpstream(
  work: WorkDetail,
  kind: ArtifactKind,
  chapter: number | undefined,
  failure: { code: KnownErrorCode; message: string },
): Artifact {
  // find：查找元素。
  const upstream = work.artifacts.find(
    (artifact) => artifact.kind === kind && artifact.chapter === chapter,
  );
  try {
    if (!upstream || upstream.humanStatus !== "approved") {
      throw new Error("pending");
    }
    // consumeGuards[kind]：校验上游内容。
    consumeGuards[kind]?.(upstream.content);
  } catch {
    throw new KnownError(failure.code, failure.message);
  }
  return upstream;
}
