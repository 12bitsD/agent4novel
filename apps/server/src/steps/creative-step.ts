import { KnownError } from "../errors.js";
import type {
  AgentConfig,
  CaptionContent,
  CreativeContent,
} from "@agent4novel/contracts";
import type { ArtifactStep } from "../pipeline/pipeline.js";
import {
  creativeLlmOutputSchema,
  creativeStepInputSchema,
  creativeStepOutputSchema,
} from "./creative-io.js";
import { callLlm, systemFor, truncateSeed } from "./llm-call.js";

export const DEFAULT_DIRECTION_COUNT = 2;

// 文案协议以 skills/creative/SKILL.md「输入(user prompt)格式」节为准(ADR-0002),此处只做数据插值
function buildPrompt(
  input: {
    seed: string;
    caption: CaptionContent;
    regeneration?: { content: CreativeContent | null; instructions: string };
  },
  count: number,
): string {
  // truncateSeed：处理当前步骤。
  // stringify：序列化数据。
  const sections = [
    `作者原始素材:\n${truncateSeed(input.seed)}`,
    `素材提炼稿:\n${JSON.stringify(input.caption, null, 2)}`,
  ];
  if (input.regeneration) {
    // push：追加元素。
    // stringify：序列化数据。
    sections.push(
      `当前已保存方向包(仅供本次再生参考):\n${JSON.stringify(input.regeneration.content, null, 2)}`,
      `作者补充想法:\n${input.regeneration.instructions}`,
    );
  }
  // push：追加元素。
  sections.push(`请产出 ${count} 个差异化的创作方向(创意稿)。`);
  // join：拼接文本。
  return sections.join("\n\n");
}

export function createCreativeStep(
  options: { systemPrompt?: string } = {},
): ArtifactStep {
  return {
    id: "creative",
    inputSchema: creativeStepInputSchema,
    outputSchema: creativeStepOutputSchema,
    async run(input, config: AgentConfig) {
      // parse：解析输入。
      const parsedInput = creativeStepInputSchema.parse(input);
      const count = config.directionCount ?? DEFAULT_DIRECTION_COUNT;
      // now：读取当前时间。
      const attemptId = `${parsedInput.workId}-creative-${Date.now()}`;
      // callLlm：处理当前步骤。
      // systemFor：处理当前步骤。
      // buildPrompt：构造当前数据。
      const raw = await callLlm({
        schema: creativeLlmOutputSchema,
        system: systemFor("creative", config, options.systemPrompt),
        prompt: buildPrompt(
          {
            seed: parsedInput.seed,
            caption: parsedInput.upstream.caption,
            regeneration: parsedInput.regeneration,
          },
          count,
        ),
        config,
        effectiveConfig: { directionCount: count },
        workId: parsedInput.workId,
        stepId: "creative",
        attemptId,
      });
      // 严格数量校验:directions.length === directionCount(#3c 决策 5)
      if (raw.directions.length !== count) {
        throw new KnownError(
          "llm-invalid-output",
          `expected ${count} directions, got ${raw.directions.length}`,
          { retryable: true, attemptId },
        );
      }
      // server 注入稳定 directionId(web 永不生成、编辑不得修改)
      // map：转换数组元素。
      const directions = raw.directions.map((d, i) => ({
        ...d,
        directionId: `${parsedInput.workId}-dir-${i + 1}`,
      }));
      return { content: { directions } };
    },
  };
}
