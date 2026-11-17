import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  beatContentSchema,
  type BeatContent,
  type BeatEditDraft,
  type BeatReviewDraft,
} from "@agent4novel/contracts";

export function assertBeatIds(
  draft: BeatEditDraft,
  baseline: BeatContent,
): void {
  // map：转换数组元素。
  const allowed = new Set(baseline.writingPlan.map((item) => item.itemId));
  const seen = new Set<string>();
  const issues: z.ZodIssue[] = [];
  // forEach：处理当前步骤。
  draft.writingPlan.forEach((item, i) => {
    if (item.itemId === undefined) {
      return;
    }
    // has：检查存在性。
    // has：检查存在性。
    if (!allowed.has(item.itemId) || seen.has(item.itemId)) {
      // push：追加元素。
      issues.push({
        code: "custom",
        path: ["writingPlan", i, "itemId"],
        message: "无效的卡片身份",
      });
    }
    // add：处理当前步骤。
    seen.add(item.itemId);
  });
  if (issues.length) {
    throw new z.ZodError(issues);
  }
}
export function assignBeatIds(
  draft: BeatReviewDraft,
  baseline?: BeatContent,
): BeatContent {
  // assertBeatIds：校验当前条件。
  assertBeatIds(
    draft,
    baseline ?? { title: "", goal: "", writingPlan: [], ending: "" },
  );
  // map：转换数组元素。
  const used = new Set(baseline?.writingPlan.map((item) => item.itemId) ?? []);
  // parse：解析输入。
  // map：转换数组元素。
  return beatContentSchema.parse({
    ...draft,
    writingPlan: draft.writingPlan.map((item) => {
      let itemId = item.itemId;
      if (!itemId) {
        // randomUUID：生成随机 ID。
        itemId = `beat-item-${randomUUID()}`;
        // has：检查存在性。
        while (used.has(itemId)) {
          // randomUUID：生成随机 ID。
          itemId = `beat-item-${randomUUID()}`;
        }
        // add：处理当前步骤。
        used.add(itemId);
      }
      return { ...item, itemId };
    }),
  });
}
