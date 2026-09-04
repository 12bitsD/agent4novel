import { randomUUID } from 'node:crypto'
import { settingDraftSchema } from '@agent4novel/contracts'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { assignSettingIds } from '../setting-content.js'
import { callLlm, loadSkill, truncateSeed } from './llm-call.js'
import { settingStepInputSchema, settingStepOutputSchema } from './setting-io.js'

export function createSettingStep(): ArtifactStep {
  return {
    id: 'setting',
    inputSchema: settingStepInputSchema,
    outputSchema: settingStepOutputSchema,
    async run(input, config) {
      const { upstream } = settingStepInputSchema.parse(input)
      const draft = await callLlm({
        schema: settingDraftSchema,
        system: loadSkill('setting'),
        prompt: [
          `作者原始素材:\n${truncateSeed(input.seed)}`,
          `素材提炼稿:\n${JSON.stringify(upstream.caption, null, 2)}`,
          `选定创作方向(创意稿):\n${JSON.stringify(upstream.creative.directions[0], null, 2)}`,
          `已通过大纲:\n${JSON.stringify(upstream.outline, null, 2)}`,
          '请整份产出完整设定，供作者编辑并通过。',
        ].join('\n\n'),
        config,
        workId: input.workId,
        stepId: 'setting',
        attemptId: `${input.workId}-setting-${randomUUID()}`,
        maxOutputTokens: 16000,
        maxRetries: 0,
      })
      return { content: assignSettingIds(settingDraftSchema.parse(draft)) }
    },
  }
}
