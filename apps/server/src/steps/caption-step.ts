import type { AgentConfig } from '@agent4novel/contracts'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { captionStepInputSchema, captionStepOutputSchema } from './caption-io.js'
import { callLlm, loadSkill, truncateSeed } from './llm-call.js'

// 文案协议以 skills/caption/SKILL.md「输入(user prompt)格式」节为准(ADR-0002),此处只做数据插值
function buildPrompt(input: { seed: string }): string {
  return `作者原始素材:\n${truncateSeed(input.seed)}\n\n请输出提炼稿。`
}

export function createCaptionStep(): ArtifactStep {
  return {
    id: 'caption',
    inputSchema: captionStepInputSchema,
    outputSchema: captionStepOutputSchema,
    async run(input, config: AgentConfig) {
      const content = await callLlm({
        schema: captionStepOutputSchema.shape.content,
        system: loadSkill('caption'),
        prompt: buildPrompt(input),
        config,
        workId: input.workId,
        stepId: 'caption',
        attemptId: `${input.workId}-caption-${Date.now()}`,
      })
      return { content }
    },
  }
}
