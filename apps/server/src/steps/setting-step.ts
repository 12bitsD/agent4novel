import { randomUUID } from "node:crypto";
import { settingDraftSchema } from "@agent4novel/contracts";
import type { ArtifactStep } from "../pipeline/pipeline.js";
import { assignSettingIds } from "../setting-content.js";
import { callLlm, systemFor, truncateSeed } from "./llm-call.js";
import {
  settingStepInputSchema,
  settingStepOutputSchema,
} from "./setting-io.js";

export function createSettingStep(
  options: { systemPrompt?: string } = {},
): ArtifactStep {
  return {
    id: "setting",
    inputSchema: settingStepInputSchema,
    outputSchema: settingStepOutputSchema,
    async run(input, config) {
      // parse：解析输入。
      const { upstream } = settingStepInputSchema.parse(input);
      // callLlm：处理当前步骤。
      // systemFor：处理当前步骤。
      // join：拼接文本。
      // truncateSeed：处理当前步骤。
      // stringify：序列化数据。
      // stringify：序列化数据。
      // stringify：序列化数据。
      // randomUUID：生成随机 ID。
      const draft = await callLlm({
        schema: settingDraftSchema,
        system: systemFor("setting", config, options.systemPrompt),
        prompt: [
          `作者原始素材:\n${truncateSeed(input.seed)}`,
          `素材提炼稿:\n${JSON.stringify(upstream.caption, null, 2)}`,
          `选定创作方向(创意稿):\n${JSON.stringify(upstream.creative.directions[0], null, 2)}`,
          `已通过大纲:\n${JSON.stringify(upstream.outline, null, 2)}`,
          "请整份产出完整设定，供作者编辑并通过。",
        ].join("\n\n"),
        config,
        workId: input.workId,
        stepId: "setting",
        attemptId: `${input.workId}-setting-${randomUUID()}`,
        maxOutputTokens: 16000,
        maxRetries: 0,
      });
      // assignSettingIds：处理当前步骤。
      return { content: assignSettingIds(draft) };
    },
  };
}
