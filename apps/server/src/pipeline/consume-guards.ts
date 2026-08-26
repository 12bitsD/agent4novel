import { creativeContentSchema } from '@agent4novel/contracts'
import type { ArtifactKind, JsonValue } from '@agent4novel/contracts'
import { KnownError } from '../errors.js'

// 消费守卫(#3c):consumes 的上游产物除了「最新版 approved」还要过的领域校验。
// 生产(index.ts)与测试共用同一份,保证守卫行为单源。
export const consumeGuards: Partial<Record<ArtifactKind, (content: JsonValue) => void>> = {
  // creative 被消费时必须恰好 1 个方向(已选定),否则不算数
  creative: (content) => {
    const parsed = creativeContentSchema.parse(content)
    if (parsed.directions.length !== 1) {
      throw new KnownError(
        'direction-not-selected',
        `creative must hold exactly 1 direction, got ${parsed.directions.length}`,
      )
    }
  },
}
