import type { ArtifactStep } from '../pipeline/pipeline.js'
import { randomUUID } from 'node:crypto'
import { beatDraftSchema, beatLimits } from '@agent4novel/contracts'
import { KnownError } from '../errors.js'
import { assignBeatIds } from '../beat-content.js'
import { callLlm, systemFor } from './llm-call.js'
import { beatStepInputSchema, beatStepOutputSchema } from './beat-io.js'

export function createBeatStep(options: { systemPrompt?: string } = {}): ArtifactStep {
  return {
    id: 'beat', inputSchema: beatStepInputSchema, outputSchema: beatStepOutputSchema,
    async run(input, config) {
      const { chapter, upstream, regeneration } = beatStepInputSchema.parse(input)
      const mode = regeneration ? 'regenerate' : 'initial'
      const system = systemFor('beat', config, options.systemPrompt)
      const prompt = [
        `模式：${mode}；当前章号：${chapter}`,
        `完整已通过大纲：\n${JSON.stringify(upstream.outline)}`,
        `完整已通过设定：\n${JSON.stringify(upstream.setting)}`,
        ...(upstream.previousChapter ? [`完整已通过上一章（实际正文优先于章纲计划）：\n${JSON.stringify(upstream.previousChapter)}`] : []),
        ...(regeneration ? [
          `作者当前页章纲（可能尚未编辑完整）：\n${JSON.stringify({ ...regeneration.content, writingPlan: regeneration.content.writingPlan.map(({ title, content }) => ({ title, content })) })}`,
          `本次修改意见：\n${regeneration.instructions}`,
        ] : []),
        `请生成第 ${chapter} 章的完整章纲，供作者审阅；只规划当前章，不生成其他章节。`,
      ].join('\n\n')
      if (system.length + prompt.length > beatLimits.maxPromptChars) throw new KnownError('input-budget-exceeded', 'assembled beat context exceeds budget', {
        inputBudget: { limit: beatLimits.maxPromptChars, actualLength: system.length + prompt.length, systemChars: system.length,
          outlineChars: JSON.stringify(upstream.outline).length, settingChars: JSON.stringify(upstream.setting).length,
          previousChapterChars: upstream.previousChapter ? JSON.stringify(upstream.previousChapter).length : 0,
          draftChars: regeneration ? JSON.stringify(regeneration.content).length : 0, instructionsChars: regeneration?.instructions.length ?? 0,
        },
      })
      const draft = await callLlm({ schema: beatDraftSchema, system, prompt, config, workId: input.workId,
        stepId: 'beat', chapter, attemptId: `${input.workId}-beat-${chapter}-${randomUUID()}`, maxOutputTokens: 8000, maxRetries: 0,
      })
      return { content: assignBeatIds(draft) }
    },
  }
}
