import { z } from 'zod'
import { jsonValueSchema } from './artifacts.js'

// 设定完整版形态定案（#3b 只定设计，生成实现见后续票）：四维度 + extra 扩展槽。
export const settingContentSchema = z.object({
  worldview: z.string(),
  powerSystem: z.string(),
  factions: z.array(z.object({ name: z.string(), description: z.string() })),
  characters: z.array(
    z.object({ name: z.string(), role: z.string(), motivation: z.string(), profile: z.string() }),
  ),
  extra: z.record(z.string(), jsonValueSchema).optional(),
})
export type SettingContent = z.infer<typeof settingContentSchema>
