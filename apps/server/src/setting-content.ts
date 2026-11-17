import { randomUUID } from "node:crypto";
import {
  settingCardSections,
  settingContentSchema,
  type SettingContent,
  type SettingReviewDraft,
} from "@agent4novel/contracts";
import { z } from "zod";

function baselineItemIds(baseline: SettingContent): Set<string> {
  // map：转换数组元素。
  // flatMap：处理当前步骤。
  // flatMap：处理当前步骤。
  return new Set(
    [
      ...settingCardSections.flatMap((column) => baseline[column]),
      ...baseline.extensions.flatMap((section) => section.items),
    ].map((item) => item.itemId),
  );
}

function checkIdentity(
  issues: z.ZodIssue[],
  value: string | undefined,
  ids: Set<string>,
  path: (string | number)[],
): void {
  // has：检查存在性。
  if (value !== undefined && !ids.has(value)) {
    // push：追加元素。
    issues.push({
      code: "custom",
      path,
      message: "身份标识不属于当前设定的同类条目",
    });
  }
}

function validateBaselineIds(
  draft: SettingReviewDraft,
  baseline: SettingContent,
): void {
  // baselineItemIds：处理当前步骤。
  const itemIds = baselineItemIds(baseline);
  // map：转换数组元素。
  const sectionIds = new Set(
    baseline.extensions.map((section) => section.sectionId),
  );
  const issues: z.ZodIssue[] = [];
  for (const column of settingCardSections) {
    // forEach：处理当前步骤。
    // checkIdentity：校验当前条件。
    draft[column].forEach((item, index) =>
      checkIdentity(issues,item.itemId, itemIds, [column, index, "itemId"]),
    );
  }
  // forEach：处理当前步骤。
  draft.extensions.forEach((section, sectionIndex) => {
    // checkIdentity：校验当前条件。
    checkIdentity(issues,section.sectionId, sectionIds, [
      "extensions",
      sectionIndex,
      "sectionId",
    ]);
    // forEach：处理当前步骤。
    // checkIdentity：校验当前条件。
    section.items.forEach((item, itemIndex) =>
      checkIdentity(issues,item.itemId, itemIds, [
        "extensions",
        sectionIndex,
        "items",
        itemIndex,
        "itemId",
      ]),
    );
  });
  if (issues.length > 0) {
    throw new z.ZodError(issues);
  }
}

function collectUsedIds(content: SettingReviewDraft, used: Set<string>): void {
  for (const column of settingCardSections) {
    for (const item of content[column]) {
      if (item.itemId) {
        // add：处理当前步骤。
        used.add(item.itemId);
      }
    }
  }
  for (const section of content.extensions) {
    if (section.sectionId) {
      // add：处理当前步骤。
      used.add(section.sectionId);
    }
    for (const item of section.items) {
      if (item.itemId) {
        // add：处理当前步骤。
        used.add(item.itemId);
      }
    }
  }
}

function assignItemIds(
  values: SettingReviewDraft["world"],
  nextId: (prefix: string) => string,
) {
  // map：转换数组元素。
  // nextId：处理当前步骤。
  return values.map((item) => ({
    ...item,
    itemId: item.itemId ?? nextId("item"),
  }));
}

// 两个创建入口（模型整份生成、作者新增卡片）共用身份分配；只返回新对象。
export function assignSettingIds(
  draft: SettingReviewDraft,
  baseline?: SettingContent,
): SettingContent {
  if (baseline) {
    // validateBaselineIds：校验当前条件。
    validateBaselineIds(draft, baseline);
  }
  const used = new Set<string>();
  // collectUsedIds：处理当前步骤。
  collectUsedIds(draft, used);
  if (baseline) {
    // collectUsedIds：处理当前步骤。
    collectUsedIds(baseline, used);
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
  // parse：解析输入。
  // assignItemIds：处理当前步骤。
  // assignItemIds：处理当前步骤。
  // assignItemIds：处理当前步骤。
  // assignItemIds：处理当前步骤。
  // map：转换数组元素。
  // nextId：处理当前步骤。
  // assignItemIds：处理当前步骤。
  return settingContentSchema.parse({
    overview: draft.overview,
    world: assignItemIds(draft.world, nextId),
    characters: assignItemIds(draft.characters, nextId),
    factions: assignItemIds(draft.factions, nextId),
    relationships: assignItemIds(draft.relationships, nextId),
    extensions: draft.extensions.map((section) => ({
      ...section,
      sectionId: section.sectionId ?? nextId("section"),
      items: assignItemIds(section.items, nextId),
    })),
  });
}
