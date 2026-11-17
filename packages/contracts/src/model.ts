import { z } from 'zod'

export type SupportedModelId = `deepseek:${string}` | `kimi:${string}` | 'longcat:LongCat-2.0'
export type ModelProvider = 'deepseek' | 'kimi' | 'longcat'

export const modelIdSchema = z.string().regex(/^(deepseek:[a-zA-Z0-9_.-]{1,96}|kimi:[a-zA-Z0-9_.-]{1,96}|longcat:LongCat-2\.0)$/)

export function parseModelId(value: unknown): SupportedModelId | null {
  const parsed = modelIdSchema.safeParse(value)
  return parsed.success ? parsed.data as SupportedModelId : null
}

export function providerForModel(value: unknown): ModelProvider | null {
  const modelId = parseModelId(value)
  if (!modelId) return null
  switch (modelId.split(':', 1)[0]) {
    case 'deepseek': return 'deepseek'
    case 'kimi': return 'kimi'
    case 'longcat': return 'longcat'
    default: return null
  }
}
