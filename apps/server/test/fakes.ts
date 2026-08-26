import { z } from 'zod'
import { jsonValueSchema, type JsonValue } from '@agent4novel/contracts'
import type { ArtifactStep, PipelineInput, PipelineOutput } from '../src/pipeline/pipeline.js'

// 测试用 fake(#3c):记录收到的输入,返回固定内容;caption/creative 通用
export function fakeArtifactStep(id: string, content: JsonValue): {
  step: ArtifactStep
  seen: PipelineInput[]
} {
  const seen: PipelineInput[] = []
  const step: ArtifactStep = {
    id,
    inputSchema: z.object({ workId: z.string(), seed: z.string(), upstream: jsonValueSchema }),
    outputSchema: z.object({ content: jsonValueSchema }),
    async run(input): Promise<PipelineOutput> {
      seen.push(input)
      return { content }
    },
  }
  return { step, seen }
}
