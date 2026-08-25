import type { ArtifactStep } from '../pipeline/pipeline.js'
import {
  preprocessStepInputSchema,
  preprocessStepOutputSchema,
  type PreprocessStepOutput,
} from './preprocess-io.js'

const DEMO_QUESTIONS = [
  '主角是谁？他/她最核心的动机是什么？',
  '故事的爽点是什么（读者为什么追下去）？',
  '故事发生在什么样的世界/背景下？',
]

// 演示模式（无 DEEPSEEK_API_KEY）：固定输出，仍走完整 schema 校验链路
export function createFakePreprocessStep(): ArtifactStep {
  return {
    id: 'preprocess',
    inputSchema: preprocessStepInputSchema,
    outputSchema: preprocessStepOutputSchema,
    async run(input): Promise<PreprocessStepOutput> {
      if (input.phase === 'questions') {
        return { content: { questions: [...DEMO_QUESTIONS] } }
      }
      return {
        content: {
          inputStage: '脑洞' as const,
          hooks: [`（演示）主角在「${input.seed.slice(0, 30)}」的处境中逆势崛起`],
          synopsis: [`（演示）${input.seed.slice(0, 60)}……故事由此展开，经转折抵达结局。`],
          setting: [{ title: '（演示）世界观', content: `基于输入：${input.seed.slice(0, 50)}` }],
          outline: [{ title: '（演示）主线', content: '开端 → 发展 → 高潮 → 结局' }],
        },
      }
    },
  }
}
