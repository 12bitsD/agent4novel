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
      const { chapter, upstream, regeneration } = proseStepInputSchema.parse(input)
      const system = options.systemPrompt ?? loadSkill('prose')
      const prompt = [
        `模式：${regeneration ? 'regenerate' : 'initial'}；当前章号：${chapter}`,
        `完整已通过章纲：\n${JSON.stringify(upstream.beat)}`,
        `完整已通过设定：\n${JSON.stringify(upstream.setting)}`,
        ...(upstream.previousChapter ? [`完整已通过上一章（实际正文优先于章纲计划）：\n${JSON.stringify(upstream.previousChapter)}`] : []),
        ...(regeneration ? [`作者当前编辑的正文：\n${JSON.stringify(regeneration.content)}`, `本次修改意见：\n${regeneration.instructions}`] : []),
        `请返回第 ${chapter} 章完整正文，供作者独立把关。保持章纲方向及章末落点，不提前续写第 ${chapter + 1} 章。`,
      ].join('\n\n')
      if (system.length + prompt.length > proseLimits.maxPromptChars) throw new KnownError('input-budget-exceeded', 'assembled prose context exceeds budget', {
        inputBudget: { limit: proseLimits.maxPromptChars, actualLength: system.length + prompt.length, systemChars: system.length,
          beatChars: JSON.stringify(upstream.beat).length, settingChars: JSON.stringify(upstream.setting).length,
          previousChapterChars: upstream.previousChapter ? JSON.stringify(upstream.previousChapter).length : 0,
          draftChars: regeneration ? JSON.stringify(regeneration.content).length : 0, instructionsChars: regeneration?.instructions.length ?? 0,
        },
      })
      const content = await callLlm({ schema: proseContentSchema, system, prompt, config, workId: input.workId,
        stepId: 'prose', chapter, attemptId: `${input.workId}-prose-${chapter}-${randomUUID()}`, maxOutputTokens: 16000, maxRetries: 0,
      })
      return { content }
    },
  }
}
