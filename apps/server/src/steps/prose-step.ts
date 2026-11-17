import { randomUUID } from "node:crypto";
import { proseContentSchema, proseLimits } from "@agent4novel/contracts";
import type { z } from "zod";
import { KnownError } from "../errors.js";
import type { ArtifactStep } from "../pipeline/pipeline.js";
import { callLlm, systemFor } from "./llm-call.js";
import { proseStepInputSchema, proseStepOutputSchema } from "./prose-io.js";
import { chars } from "./prompt-section.js";

type ProseInput = z.infer<typeof proseStepInputSchema>;

function prosePrompt(input: ProseInput) {
  const chapter = input.chapter;
  const upstream = input.upstream;
  const regeneration = input.regeneration;
  // stringify：序列化数据。
  const beatText = JSON.stringify(upstream.beat);
  // stringify：序列化数据。
  const settingText = JSON.stringify(upstream.setting);
  // stringify：序列化数据。
  const previousChapterText = upstream.previousChapter
    ? JSON.stringify(upstream.previousChapter)
    : undefined;
  // stringify：序列化数据。
  const draftText = regeneration
    ? JSON.stringify(regeneration.content)
    : undefined;
  const sections = [
    `模式：${regeneration ? "regenerate" : "initial"}；当前章号：${chapter}`,
    `完整已通过章纲：\n${beatText}`,
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
    sections.push(`作者当前编辑的正文：\n${draftText}`);
    // push：追加元素。
    sections.push(`本次修改意见：\n${regeneration.instructions}`);
  }
  // push：追加元素。
  sections.push(
    `请返回第 ${chapter} 章完整正文，供作者独立把关。保持章纲方向及章末落点，不提前续写第 ${chapter + 1} 章。`,
  );
  // join：拼接文本。
  return {
    prompt: sections.join("\n\n"),
    beatText,
    settingText,
    previousChapterText,
    draftText,
    instructionsChars: regeneration ? regeneration.instructions.length : 0,
  };
}

function assertProseBudget(
  system: string,
  context: ReturnType<typeof prosePrompt>,
): void {
  const actualLength = system.length + context.prompt.length;
  if (actualLength <= proseLimits.maxPromptChars) {
    return;
  }
  // chars：处理当前步骤。
  // chars：处理当前步骤。
  throw new KnownError(
    "input-budget-exceeded",
    "assembled prose context exceeds budget",
    {
      inputBudget: {
        limit: proseLimits.maxPromptChars,
        actualLength,
        systemChars: system.length,
        beatChars: context.beatText.length,
        settingChars: context.settingText.length,
        previousChapterChars: chars(context.previousChapterText),
        draftChars: chars(context.draftText),
        instructionsChars: context.instructionsChars,
      },
    },
  );
}

export function createProseStep(
  options: { systemPrompt?: string } = {},
): ArtifactStep {
  return {
    id: "prose",
    inputSchema: proseStepInputSchema,
    outputSchema: proseStepOutputSchema,
    async run(input, config) {
      // parse：解析输入。
      const parsed = proseStepInputSchema.parse(input);
      // systemFor：处理当前步骤。
      const system = systemFor("prose", config, options.systemPrompt);
      // prosePrompt：处理当前步骤。
      const context = prosePrompt(parsed);
      // assertProseBudget：校验当前条件。
      assertProseBudget(system, context);
      // callLlm：处理当前步骤。
      // randomUUID：生成随机 ID。
      const content = await callLlm({
        schema: proseContentSchema,
        system,
        prompt: context.prompt,
        config,
        workId: input.workId,
        stepId: "prose",
        chapter: parsed.chapter,
        attemptId: `${input.workId}-prose-${parsed.chapter}-${randomUUID()}`,
        maxOutputTokens: 16000,
        maxRetries: 0,
      });
      return { content };
    },
  };
}
