import type { ArtifactStep } from '../pipeline/pipeline.js'
import { captionStepInputSchema, captionStepOutputSchema } from './caption-io.js'
import { creativeStepInputSchema, creativeStepOutputSchema } from './creative-io.js'
import { DEFAULT_DIRECTION_COUNT } from './creative-step.js'

// 演示模式(无 DEEPSEEK_API_KEY):固定输出,仍走完整 schema 校验链路

export function createFakeCaptionStep(): ArtifactStep {
  return {
    id: 'caption',
    inputSchema: captionStepInputSchema,
    outputSchema: captionStepOutputSchema,
    async run(input) {
      return {
        content: {
          inputStage: '脑洞' as const,
          summary: `(演示)一份关于「${input.seed.slice(0, 40)}」的素材,核心是一个差异化点子。`,
          elements: [
            { kind: '设定', content: `基于输入:${input.seed.slice(0, 50)}` },
            { kind: '冲突', content: '(演示)主角处境与目标之间的核心矛盾' },
          ],
          gaps: ['(演示)主角动机未明确'],
        },
      }
    },
  }
}

export function createFakeCreativeStep(): ArtifactStep {
  return {
    id: 'creative',
    inputSchema: creativeStepInputSchema,
    outputSchema: creativeStepOutputSchema,
    async run(input, config) {
      const count = config.directionCount ?? DEFAULT_DIRECTION_COUNT
      const flavors = ['稳健王道', '黑深残', '轻松日常']
      return {
        content: {
          directions: Array.from({ length: count }, (_, i) => ({
            directionId: `${input.workId}-dir-${i + 1}`,
            title: `(演示)方向${'ABC'[i]}:${flavors[i] ?? `变体${i + 1}`}`,
            hook: `(演示)主角在「${input.seed.slice(0, 30)}」中以${flavors[i] ?? '独特'}方式逆势崛起`,
            tags: ['演示', flavors[i] ?? `变体${i + 1}`],
            synopsis: `(演示)${input.seed.slice(0, 60)}……故事以${flavors[i] ?? '独特'}基调展开,经转折抵达结局。`,
            characters: [{ title: '主角', content: `(演示)${flavors[i] ?? '普通'}路线的主人公` }],
            setting: [{ title: '(演示)世界观', content: `基于输入:${input.seed.slice(0, 50)}` }],
            payoffs: [`(演示)${flavors[i] ?? '独特'}爽点:以小博大`],
            outline: [{ title: '(演示)主线', content: '开端 → 发展 → 高潮 → 结局' }],
          })),
        },
      }
    },
  }
}
