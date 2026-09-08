import type { ArtifactStep } from '../pipeline/pipeline.js'
import { randomUUID } from 'node:crypto'
import { beatDraftSchema, beatLimits } from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import { assignBeatIds } from '../beat-content.js'
import { callLlm, loadSkill } from './llm-call.js'
import { beatStepInputSchema, beatStepOutputSchema } from './beat-io.js'

export function createBeatStep(): ArtifactStep {
  return {
    id: 'beat', inputSchema: beatStepInputSchema, outputSchema: beatStepOutputSchema,
    async run(input, config) {
      const { upstream, regeneration } = beatStepInputSchema.parse(input)
      const mode = regeneration ? 'regenerate' : 'initial'
      const system = loadSkill('beat')
      const prompt = [
        `模式：${mode}；当前章号：1`,
        `完整已通过大纲：\n${JSON.stringify(upstream.outline)}`,
        `完整已通过设定：\n${JSON.stringify(upstream.setting)}`,
        ...(regeneration ? [
          `作者当前页章纲（可能尚未编辑完整）：\n${JSON.stringify({ ...regeneration.content, writingPlan: regeneration.content.writingPlan.map(({ title, content }) => ({ title, content })) })}`,
          `本次修改意见：\n${regeneration.instructions}`,
        ] : []),
        '请生成第一章的完整章纲，供作者审阅。',
      ].join('\n\n')
      if (system.length + prompt.length > beatLimits.maxPromptChars) throw new KnownError('input-budget-exceeded', 'assembled beat context exceeds budget', {
        inputBudget: { limit: beatLimits.maxPromptChars, actualLength: system.length + prompt.length, systemChars: system.length,
          outlineChars: JSON.stringify(upstream.outline).length, settingChars: JSON.stringify(upstream.setting).length,
          draftChars: regeneration ? JSON.stringify(regeneration.content).length : 0, instructionsChars: regeneration?.instructions.length ?? 0,
        },
      })
      const draft = await callLlm({ schema: beatDraftSchema, system, prompt, config, workId: input.workId,
        stepId: 'beat', attemptId: `${input.workId}-beat-${randomUUID()}`, maxOutputTokens: 8000, maxRetries: 0,
      })
      return { content: assignBeatIds(draft) }
    },
  }
}
