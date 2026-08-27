import { creativeContentSchema } from '@agent4novel/contracts'
import type { AgentConfig, CreativeContent } from '@agent4novel/contracts'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { outlineLlmOutputSchema, outlineStepInputSchema, outlineStepOutputSchema } from './outline-io.js'
import { callLlm, loadSkill, truncateSeed } from './llm-call.js'

// 文案协议以 skills/outline/SKILL.md「输入(user prompt)格式」节为准(ADR-0002),此处只做数据插值
function buildPrompt(input: { seed: string; creative: CreativeContent }): string {
  return [
    `作者原始素材:\n${truncateSeed(input.seed)}`,
    `选定创作方向(创意稿):\n${JSON.stringify(input.creative.directions[0], null, 2)}`,
    `请产出全书大纲(弧线 + 剧情点两层结构)。`,
  ].join('\n\n')
}

export function createOutlineStep(): ArtifactStep {
  return {
    id: 'outline',
    inputSchema: outlineStepInputSchema,
    outputSchema: outlineStepOutputSchema,
    async run(input, config: AgentConfig) {
      const attemptId = `${input.workId}-outline-${Date.now()}`
      // runStep 已过 inputSchema;这里把 upstream.creative 从 JsonValue 恢复到具体类型。
      // 消费守卫(pipeline/consume-guards.ts)已保证恰好 1 个选定方向。
      const creative = creativeContentSchema.parse(
        (input.upstream as Record<string, unknown>).creative,
      )
      const raw = await callLlm({
        schema: outlineLlmOutputSchema,
        system: loadSkill('outline'),
        prompt: buildPrompt({ seed: input.seed, creative }),
        config,
        stepId: 'outline',
        attemptId,
      })
      // server 注入稳定 arcId/segmentId(web 永不生成、编辑不得修改)
      const arcs = raw.arcs.map((arc, i) => {
        const arcId = `${input.workId}-arc-${i + 1}`
        return {
          ...arc,
          arcId,
          segments: arc.segments.map((seg, j) => ({
            ...seg,
            segmentId: `${arcId}-seg-${j + 1}`,
          })),
        }
      })
      return { content: { arcs } }
    },
  }
}
