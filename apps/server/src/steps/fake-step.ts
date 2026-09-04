import type { ArtifactStep } from '../pipeline/pipeline.js'
import { captionStepInputSchema, captionStepOutputSchema } from './caption-io.js'
import { creativeStepInputSchema, creativeStepOutputSchema } from './creative-io.js'
import { outlineStepInputSchema, outlineStepOutputSchema } from './outline-io.js'
import { DEFAULT_DIRECTION_COUNT } from './creative-step.js'
import { settingStepInputSchema, settingStepOutputSchema } from './setting-io.js'
import { assignSettingIds } from '../setting-content.js'

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
      return {
        content: {
          directions: Array.from({ length: count }, (_, i) => {
            // 第 i 个方向的演示基调(directionCount ≤ 3,schema 保证不越界)
            const flavor = ['稳健王道', '黑深残', '轻松日常'][i]!
            return {
              directionId: `${input.workId}-dir-${i + 1}`,
              title: `(演示)方向${'ABC'[i]}:${flavor}`,
              hook: `(演示)主角在「${input.seed.slice(0, 30)}」中以${flavor}方式逆势崛起`,
              tags: ['演示', flavor],
              synopsis: `(演示)${input.seed.slice(0, 60)}……故事以${flavor}基调展开,经转折抵达结局。`,
              characters: [{ title: '主角', content: `(演示)${flavor}路线的主人公` }],
              setting: [{ title: '(演示)世界观', content: `基于输入:${input.seed.slice(0, 50)}` }],
              payoffs: [`(演示)${flavor}爽点:以小博大`],
              outline: [{ title: '(演示)主线', content: '开端 → 发展 → 高潮 → 结局' }],
            }
          }),
        },
      }
    },
  }
}

// 演示大纲:3 弧 × 3 剧情点,确定性产出(数量边界内:弧线 3~8、每弧剧情点 2~8)
export function createFakeOutlineStep(): ArtifactStep {
  const arcTitles = ['开局立足', '冲突升级', '高潮收束']
  return {
    id: 'outline',
    inputSchema: outlineStepInputSchema,
    outputSchema: outlineStepOutputSchema,
    async run(input) {
      return {
        content: {
          arcs: arcTitles.map((title, i) => {
            const arcId = `${input.workId}-arc-${i + 1}`
            return {
              arcId,
              title: `(演示)${title}`,
              conflict: `(演示)第 ${i + 1} 弧核心冲突:基于「${input.seed.slice(0, 30)}」的矛盾`,
              development: `(演示)冲突逐步升级,主角应对并成长`,
              resolution: `(演示)矛盾解决,收束到新的局势起点`,
              segments: [1, 2, 3].map((j) => ({
                segmentId: `${arcId}-seg-${j}`,
                title: `(演示)剧情点 ${j}`,
                summary: `(演示)本段发生的关键事件 ${j}`,
                outcome: `(演示)本段结束后的局势 ${j}`,
              })),
            }
          }),
        },
      }
    },
  }
}

export function createFakeSettingStep(): ArtifactStep {
  return {
    id: 'setting', inputSchema: settingStepInputSchema, outputSchema: settingStepOutputSchema,
    async run(input) {
      const { upstream } = settingStepInputSchema.parse(input)
      const direction = upstream.creative.directions[0]!
      return { content: assignSettingIds({
        overview: `(演示)${direction.synopsis}`,
        world: [{ title: '故事世界', content: `(演示)基于「${input.seed.slice(0, 80)}」展开，世界规则在整部作品中保持一致。` }],
        characters: [{ title: '主角', content: `(演示)围绕「${direction.hook}」行动，在关键选择中成长。` }],
        factions: [], relationships: [], extensions: [],
      }) }
    },
  }
}
