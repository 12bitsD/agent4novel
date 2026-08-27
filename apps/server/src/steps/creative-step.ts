import { captionContentSchema } from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { AgentConfig, CaptionContent } from '@agent4novel/contracts'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { creativeLlmOutputSchema, creativeStepInputSchema, creativeStepOutputSchema } from './creative-io.js'
import { callLlm, loadSkill, truncateSeed } from './llm-call.js'

export const DEFAULT_DIRECTION_COUNT = 2

// 文案协议以 skills/creative/SKILL.md「输入(user prompt)格式」节为准(ADR-0002),此处只做数据插值
function buildPrompt(input: { seed: string; caption: CaptionContent }, count: number): string {
  return [
    `作者原始素材:\n${truncateSeed(input.seed)}`,
    `素材提炼稿:\n${JSON.stringify(input.caption, null, 2)}`,
    `请产出 ${count} 个差异化的创作方向(创意稿)。`,
  ].join('\n\n')
}

export function createCreativeStep(): ArtifactStep {
  return {
    id: 'creative',
    inputSchema: creativeStepInputSchema,
    outputSchema: creativeStepOutputSchema,
    async run(input, config: AgentConfig) {
      const count = config.directionCount ?? DEFAULT_DIRECTION_COUNT
      const attemptId = `${input.workId}-creative-${Date.now()}`
      // runStep 已过 inputSchema;这里把 upstream.caption 从 JsonValue 恢复到具体类型
      const caption = captionContentSchema.parse(
        (input.upstream as Record<string, unknown>).caption,
      )
      const raw = await callLlm({
        schema: creativeLlmOutputSchema,
        system: loadSkill('creative'),
        prompt: buildPrompt({ seed: input.seed, caption }, count),
        config,
        workId: input.workId,
        stepId: 'creative',
        attemptId,
      })
      // 严格数量校验:directions.length === directionCount(#3c 决策 5)
      if (raw.directions.length !== count) {
        throw new KnownError(
          'llm-invalid-output',
          `expected ${count} directions, got ${raw.directions.length}`,
          { retryable: true, attemptId },
        )
      }
      // server 注入稳定 directionId(web 永不生成、编辑不得修改)
      const directions = raw.directions.map((d, i) => ({
        ...d,
        directionId: `${input.workId}-dir-${i + 1}`,
      }))
      return { content: { directions } }
    },
  }
}
