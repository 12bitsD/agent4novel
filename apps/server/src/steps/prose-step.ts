import { randomUUID } from 'node:crypto'
import { proseContentSchema, proseLimits } from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { callLlm, systemFor } from './llm-call.js'
import { proseStepInputSchema, proseStepOutputSchema } from './prose-io.js'

export function createProseStep(options: { systemPrompt?: string } = {}): ArtifactStep {
  return {
    id: 'prose', inputSchema: proseStepInputSchema, outputSchema: proseStepOutputSchema,
    async run(input, config) {
      const { chapter, upstream, regeneration } = proseStepInputSchema.parse(input)
      const system = systemFor('prose', config, options.systemPrompt)
      const beatText = JSON.stringify(upstream.beat)
      const settingText = JSON.stringify(upstream.setting)
      const previousChapterText = upstream.previousChapter ? JSON.stringify(upstream.previousChapter) : undefined
      const draftText = regeneration ? JSON.stringify(regeneration.content) : undefined
      const prompt = [
        `模式：${regeneration ? 'regenerate' : 'initial'}；当前章号：${chapter}`,
        `完整已通过章纲：\n${beatText}`,
        `完整已通过设定：\n${settingText}`,
        ...(previousChapterText ? [`完整已通过上一章（实际正文优先于章纲计划）：\n${previousChapterText}`] : []),
        ...(regeneration ? [`作者当前编辑的正文：\n${draftText}`, `本次修改意见：\n${regeneration.instructions}`] : []),
        `请返回第 ${chapter} 章完整正文，供作者独立把关。保持章纲方向及章末落点，不提前续写第 ${chapter + 1} 章。`,
      ].join('\n\n')
      if (system.length + prompt.length > proseLimits.maxPromptChars) throw new KnownError('input-budget-exceeded', 'assembled prose context exceeds budget', {
        inputBudget: { limit: proseLimits.maxPromptChars, actualLength: system.length + prompt.length, systemChars: system.length,
          beatChars: beatText.length, settingChars: settingText.length,
          previousChapterChars: previousChapterText?.length ?? 0,
          draftChars: draftText?.length ?? 0, instructionsChars: regeneration?.instructions.length ?? 0,
        },
      })
      const content = await callLlm({ schema: proseContentSchema, system, prompt, config, workId: input.workId,
        stepId: 'prose', chapter, attemptId: `${input.workId}-prose-${chapter}-${randomUUID()}`, maxOutputTokens: 16000, maxRetries: 0,
      })
      return { content }
    },
  }
}
