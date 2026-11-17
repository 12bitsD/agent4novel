import type { ArtifactStep } from "../pipeline/pipeline.js";
import { randomUUID } from "node:crypto";
import { beatDraftSchema, beatLimits } from "@agent4novel/contracts";
import type { z } from "zod";
import { KnownError } from "../errors.js";
import { assignBeatIds } from "../beat-content.js";
import { callLlm, systemFor } from "./llm-call.js";
import { beatStepInputSchema, beatStepOutputSchema } from "./beat-io.js";
import { chars } from "./prompt-section.js";

type BeatInput = z.infer<typeof beatStepInputSchema>;

function beatPrompt(input: BeatInput) {
  const chapter = input.chapter;
  const upstream = input.upstream;
  const regeneration = input.regeneration;
  // stringify：序列化数据。
  const outlineText = JSON.stringify(upstream.outline);
  // stringify：序列化数据。
  const settingText = JSON.stringify(upstream.setting);
  // stringify：序列化数据。
  const previousChapterText = upstream.previousChapter
    ? JSON.stringify(upstream.previousChapter)
    : undefined;
  // stringify：序列化数据。
  // map：转换数组元素。
  const draftText = regeneration
    ? JSON.stringify({
        ...regeneration.content,
        writingPlan: regeneration.content.writingPlan.map(
          ({ title, content }) => ({ title, content }),
        ),
      })
    : undefined;
  const sections = [
    `模式：${regeneration ? "regenerate" : "initial"}；当前章号：${chapter}`,
    `完整已通过大纲：\n${outlineText}`,
    `完整已通过设定：\n${settingText}`,
  ];
  if (previousChapterText) {
    // push：追加元素。
    sections.push(
      `完整已通过上一章（实际正文优先于章纲计划）：\n${previousChapterText}`,
    );
  }
  if (regeneration) {
    // push：追加元素。
    sections.push(`作者当前页章纲（可能尚未编辑完整）：\n${draftText}`);
    // push：追加元素。
    sections.push(`本次修改意见：\n${regeneration.instructions}`);
  }
  // push：追加元素。
  sections.push(
    `请生成第 ${chapter} 章的完整章纲，供作者审阅；只规划当前章，不生成其他章节。`,
  );
  // join：拼接文本。
  return {
    prompt: sections.join("\n\n"),
    outlineText,
    settingText,
    previousChapterText,
    draftText,
    instructionsChars: regeneration ? regeneration.instructions.length : 0,
  };
}

function assertBeatBudget(
  system: string,
  context: ReturnType<typeof beatPrompt>,
): void {
  const actualLength = system.length + context.prompt.length;
  if (actualLength <= beatLimits.maxPromptChars) {
    return;
  }
  // chars：处理当前步骤。
  // chars：处理当前步骤。
  throw new KnownError("input-budget-exceeded", "assembled beat context exceeds budget", {
    inputBudget: {
      limit: beatLimits.maxPromptChars,
      actualLength,
      systemChars: system.length,
      outlineChars: context.outlineText.length,
      settingChars: context.settingText.length,
      previousChapterChars: chars(context.previousChapterText),
      draftChars: chars(context.draftText),
      instructionsChars: context.instructionsChars,
    },
  });
}

export function createBeatStep(
  options: { systemPrompt?: string } = {},
): ArtifactStep {
  return {
    id: "beat",
    inputSchema: beatStepInputSchema,
    outputSchema: beatStepOutputSchema,
    async run(input, config) {
      // parse：解析输入。
      const parsed = beatStepInputSchema.parse(input);
      // systemFor：处理当前步骤。
      const system = systemFor("beat", config, options.systemPrompt);
      // beatPrompt：处理当前步骤。
      const context = beatPrompt(parsed);
      // assertBeatBudget：校验当前条件。
      assertBeatBudget(system, context);
      // callLlm：处理当前步骤。
      // randomUUID：生成随机 ID。
      const draft = await callLlm({
        schema: beatDraftSchema,
        system,
        prompt: context.prompt,
        config,
        workId: input.workId,
        stepId: "beat",
        chapter: parsed.chapter,
        attemptId: `${input.workId}-beat-${parsed.chapter}-${randomUUID()}`,
        maxOutputTokens: 8000,
        maxRetries: 0,
      });
      // assignBeatIds：处理当前步骤。
      return { content: assignBeatIds(draft) };
    },
  };
}
