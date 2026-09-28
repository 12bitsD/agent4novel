import { randomUUID } from 'node:crypto'
import { proseContentSchema, proseLimits } from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { callLlm, loadSkill } from './llm-call.js'
import { proseStepInputSchema, proseStepOutputSchema } from './prose-io.js'

export function createProseStep(options: { systemPrompt?: string } = {}): ArtifactStep {
  return {
    id: 'prose', inputSchema: proseStepInputSchema, outputSchema: proseStepOutputSchema,
    async run(input, config) {
      const { upstream, regeneration } = proseStepInputSchema.parse(input)
      const system = options.systemPrompt ?? loadSkill('prose')
      const prompt = [
        `模式：${regeneration ? 'regenerate' : 'initial'}；当前章号：1`,
        `完整已通过章纲：\n${JSON.stringify(upstream.beat)}`,
        `完整已通过设定：\n${JSON.stringify(upstream.setting)}`,
        ...(regeneration ? [`作者当前编辑的正文：\n${JSON.stringify(regeneration.content)}`, `本次修改意见：\n${regeneration.instructions}`] : []),
        '请返回第一章完整正文，供作者独立把关。保持章纲方向及章末落点，不续写第二章。',
      ].join('\n\n')
      if (system.length + prompt.length > proseLimits.maxPromptChars) throw new KnownError('input-budget-exceeded', 'assembled prose context exceeds budget', {
        inputBudget: { limit: proseLimits.maxPromptChars, actualLength: system.length + prompt.length, systemChars: system.length,
          beatChars: JSON.stringify(upstream.beat).length, settingChars: JSON.stringify(upstream.setting).length,
          draftChars: regeneration ? JSON.stringify(regeneration.content).length : 0, instructionsChars: regeneration?.instructions.length ?? 0,
        },
      })
      const content = await callLlm({ schema: proseContentSchema, system, prompt, config, workId: input.workId,
        stepId: 'prose', attemptId: `${input.workId}-prose-${randomUUID()}`, maxOutputTokens: 16000, maxRetries: 0,
      })
      return { content }
    },
  }
}
