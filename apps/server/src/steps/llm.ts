import { createProviderRegistry } from 'ai'
import { deepSeek } from '@ai-sdk/deepseek'

// 唯一感知 provider 的模块；上游步骤只认 model id 字符串（research: docs/research/llm-provider-strategy.md）
export const registry = createProviderRegistry({
  deepseek: deepSeek, // 按约定读 DEEPSEEK_API_KEY；baseURL 默认 https://api.deepseek.com
})

export const hasLlmKey = (): boolean => Boolean(process.env.DEEPSEEK_API_KEY)

// unverified：确切模型名待真 key 实测（research 已标；'deepseek-chat' 为 AI SDK 文档示例值）
export const defaultModelId = 'deepseek:deepseek-chat'
