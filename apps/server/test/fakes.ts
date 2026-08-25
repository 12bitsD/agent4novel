import { z } from 'zod'
import { jsonValueSchema, type JsonValue } from '@agent4novel/contracts'
import type { ArtifactStep, PipelineInput, PipelineOutput } from '../src/pipeline/pipeline.js'
import { preprocessStepInputSchema } from '../src/steps/preprocess-io.js'

export { preprocessStepInputSchema }

// 测试用 fake：questions 阶段回固定问题，normalize 阶段回固定要点 JSON，并记录收到的输入
export function fakePreprocessStep(overrides?: {
  questions?: string[]
  content?: JsonValue
}): { step: ArtifactStep; seen: PipelineInput[] } {
  const seen: PipelineInput[] = []
  const step: ArtifactStep = {
    id: 'preprocess',
    inputSchema: preprocessStepInputSchema,
    outputSchema: z.object({ content: jsonValueSchema }),
    async run(input): Promise<PipelineOutput> {
      seen.push(input)
      const content: JsonValue =
        input.phase === 'questions'
          ? {
              questions: overrides?.questions ?? [
                '主角是谁？',
                '爽点是什么？',
                '故事发生在什么世界？',
              ],
            }
          : (overrides?.content ?? {
              inputStage: '脑洞',
              hooks: ['卖点（fake）'],
              synopsis: ['梗概（fake）'],
              setting: [],
              outline: [],
            })
      return { content }
    },
  }
  return { step, seen }
}
