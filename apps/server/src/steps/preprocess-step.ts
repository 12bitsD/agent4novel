import { readFileSync } from 'node:fs'
import { generateText } from 'ai'
import { interviewQuestionsSchema, preprocessContentSchema } from '@agent4novel/contracts'
import type { AgentConfig, InterviewAnswer } from '@agent4novel/contracts'
import type { ArtifactStep } from '../pipeline/pipeline.js'
import { defaultModelId, registry } from './llm.js'
import { preprocessStepInputSchema, preprocessStepOutputSchema } from './preprocess-io.js'

// 提示词以文件维护（ADR-0002），模块级缓存
let skillCache: string | undefined
function loadSkill(): string {
  if (!skillCache) {
    skillCache = readFileSync(new URL('./skills/preprocess/SKILL.md', import.meta.url), 'utf8')
  }
  return skillCache
}

function buildPrompt(input: {
  seed: string
  phase?: 'questions' | 'normalize' // 缺省 = normalize（inputSchema default 的运行时兜底）
  answers?: InterviewAnswer[]
}): string {
  const phase = input.phase ?? 'normalize'
  if (phase === 'questions') {
    return `作者原始输入：\n${input.seed}\n\n请按 questions 阶段要求输出。`
  }
  const qa = input.answers?.length
    ? input.answers.map((a) => `问：${a.question}\n答：${a.answer}`).join('\n\n')
    : '（作者未作答，直接基于原始输入补全）'
  return `作者原始输入：\n${input.seed}\n\n问答记录：\n${qa}\n\n请按 normalize 阶段要求输出。`
}

// model 输出约定为纯 JSON；容错剥掉 markdown 围栏
function parseJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
  try {
    return JSON.parse(stripped)
  } catch {
    throw new Error('llm output is not valid JSON')
  }
}

export function createPreprocessStep(): ArtifactStep {
  return {
    id: 'preprocess',
    inputSchema: preprocessStepInputSchema,
    outputSchema: preprocessStepOutputSchema,
    async run(input, config: AgentConfig) {
      const { text } = await generateText({
        // registry 类型只收 `deepseek:${string}` 模板字面量；config.model 是开放字符串，收窄在此一处
        model: registry.languageModel((config.model ?? defaultModelId) as `deepseek:${string}`),
        system: loadSkill(),
        prompt: buildPrompt(input),
      })
      const data = parseJsonObject(text)
      // 按 phase 严格校验（agent 输出不稳时的兜底；runStep 还会再过一次 outputSchema）
      const content =
        input.phase === 'questions'
          ? interviewQuestionsSchema.parse(data)
          : preprocessContentSchema.parse(data)
      return { content }
    },
  }
}
